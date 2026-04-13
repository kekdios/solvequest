/**
 * Polls Solana mainnet for USDC SPL deposits to each account's sol_receive_address,
 * Appends `qusd_ledger` + deposit_credits, bumps sync_version.
 */
import fs from "node:fs";
import path from "node:path";
import { Connection, PublicKey } from "@solana/web3.js";
import Database from "better-sqlite3";
import { parseQusdMultiplier } from "../src/lib/qusdMultiplier";
import { decryptCustodialKeypair } from "./depositWalletCrypto";
import { insertSolanaUsdcCredit } from "./qusdLedger";
import { sweepCustodialDepositToTreasury } from "./custodialSweepServer";
import { scanNewUsdcDeposits, type ScanLedger } from "./solanaUsdcScan";

type SqliteDb = InstanceType<typeof Database>;

function resolveDbPath(root: string, env: NodeJS.ProcessEnv): string {
  return env.SOLVEQUEST_DB_PATH?.trim() || path.join(root, "data", "solvequest.db");
}

function rpcUrl(env: NodeJS.ProcessEnv): string {
  return (
    env.SOLANA_RPC_URL?.trim() ||
    env.SOLANA_RPC_PROXY_TARGET?.trim() ||
    "https://api.mainnet-beta.solana.com"
  );
}

export function startDepositScanWorker(root: string, env: NodeJS.ProcessEnv): void {
  const disabled = env.SOLVEQUEST_DEPOSIT_SCAN === "0" || env.SOLVEQUEST_DEPOSIT_SCAN === "false";
  if (disabled) {
    console.log("[deposit-scan] disabled (SOLVEQUEST_DEPOSIT_SCAN=0)");
    return;
  }

  const qusdPerUsdc = parseQusdMultiplier(env.QUSD_MULTIPLIER ?? env.VITE_QUSD_MULTIPLIER);

  const dbPath = resolveDbPath(root, env);
  const intervalMs = Math.max(
    10_000,
    Number.parseInt(env.SOLVEQUEST_DEPOSIT_SCAN_INTERVAL_MS ?? "45000", 10) || 45_000,
  );

  let db: SqliteDb | null = null;
  const getDb = (): SqliteDb | null => {
    if (db) return db;
    if (!fs.existsSync(dbPath)) {
      console.warn(`[deposit-scan] database missing at ${dbPath} — skipping worker`);
      return null;
    }
    try {
      db = new Database(dbPath);
      db.pragma("foreign_keys = ON");
      return db;
    } catch (e) {
      console.error("[deposit-scan] open db:", e);
      return null;
    }
  };

  const connection = new Connection(rpcUrl(env), "confirmed");

  const tick = async () => {
    const database = getDb();
    if (!database) return;

    let rows: { id: string; sol_receive_address: string }[];
    try {
      rows = database
        .prepare(
          `SELECT id, sol_receive_address FROM accounts
           WHERE sol_receive_address IS NOT NULL AND TRIM(sol_receive_address) != ''`,
        )
        .all() as { id: string; sol_receive_address: string }[];
    } catch (e) {
      console.error("[deposit-scan] list accounts:", e);
      return;
    }

    for (const { id: accountId, sol_receive_address: addr } of rows) {
      try {
        await processAccount(database, connection, accountId, addr, qusdPerUsdc, env);
      } catch (e) {
        console.error(`[deposit-scan] account ${accountId}:`, e);
      }
    }
  };

  void tick();
  setInterval(() => void tick(), intervalMs);
  console.log(
    `[deposit-scan] every ${intervalMs}ms → ${dbPath} (RPC ${rpcUrl(env).slice(0, 48)}…; QUSD_MULTIPLIER=${qusdPerUsdc})`,
  );
}

async function processAccount(
  database: SqliteDb,
  connection: Connection,
  accountId: string,
  solReceiveAddress: string,
  qusdPerUsdc: number,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  let owner: PublicKey;
  try {
    owner = new PublicKey(solReceiveAddress.trim());
  } catch {
    console.warn(`[deposit-scan] invalid sol_receive_address for ${accountId}`);
    return;
  }

  const wmRow = database
    .prepare(`SELECT watermark_signature FROM deposit_scan_state WHERE account_id = ?`)
    .get(accountId) as { watermark_signature: string | null } | undefined;

  const ledger: ScanLedger = {
    watermarkUsdcAta: wmRow?.watermark_signature ?? null,
  };

  const { credits, ledger: next } = await scanNewUsdcDeposits(connection, owner, ledger);

  const creditOne = database.transaction(
    (signature: string, amountUsdc: number, creditedAt: number) => {
      const ins = database.prepare(
        `INSERT OR IGNORE INTO deposit_credits (account_id, chain, signature, kind, amount_human, credited_at)
         VALUES (?, 'solana', ?, 'usdc', ?, ?)`,
      );
      const r = ins.run(accountId, signature, amountUsdc, creditedAt);
      if (r.changes === 0) return;
      const qusd = amountUsdc * qusdPerUsdc;
      insertSolanaUsdcCredit(database, accountId, qusd, signature, creditedAt);
      database
        .prepare(
          `UPDATE accounts SET sync_version = sync_version + 1, updated_at = ?
           WHERE id = ?`,
        )
        .run(creditedAt, accountId);
      console.log(
        `[deposit-scan] credited ${accountId.slice(0, 8)}… +${qusd.toFixed(2)} QUSD (${amountUsdc} USDC) sig ${signature.slice(0, 10)}…`,
      );
    },
  );

  const now = Date.now();
  for (const c of credits) {
    try {
      creditOne(c.signature, c.amountUsdc, now);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE") || msg.includes("constraint")) continue;
      throw e;
    }
  }

  database
    .prepare(
      `INSERT INTO deposit_scan_state (account_id, watermark_signature)
       VALUES (?, ?)
       ON CONFLICT(account_id) DO UPDATE SET watermark_signature = excluded.watermark_signature`,
    )
    .run(accountId, next.watermarkUsdcAta);

  const sweepOn =
    env.SOLVEQUEST_CUSTODIAL_SWEEP === "1" || env.SOLVEQUEST_CUSTODIAL_SWEEP === "true";
  if (!sweepOn) return;

  let enc: string | null = null;
  try {
    const crow = database
      .prepare(`SELECT custodial_seckey_enc FROM accounts WHERE id = ?`)
      .get(accountId) as { custodial_seckey_enc: string | null } | undefined;
    enc = crow?.custodial_seckey_enc ?? null;
  } catch {
    return;
  }
  if (!enc) return;

  try {
    const kp = decryptCustodialKeypair(enc, env);
    const r = await sweepCustodialDepositToTreasury(connection, env, kp);
    if (r.ok) {
      console.log(
        `[deposit-scan] custodial sweep ${accountId.slice(0, 8)}… +${r.sweptUsdc.toFixed(4)} USDC (tx ${r.signature.slice(0, 12)}…)`,
      );
    }
  } catch (e) {
    console.warn(`[deposit-scan] custodial sweep failed ${accountId.slice(0, 8)}…:`, e);
  }
}
