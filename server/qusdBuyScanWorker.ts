/**
 * Buy QUSD (Solana): poll mainnet for USDC SPL to each account's verified `sol_receive_address`,
 * append `qusd_ledger` + `deposit_credits`, bump `sync_version`.
 */
import fs from "node:fs";
import path from "node:path";
import { Connection, PublicKey } from "@solana/web3.js";
import Database from "better-sqlite3";
import { parseQusdMultiplier } from "../src/lib/qusdMultiplier";
import { insertSolanaUsdcCredit } from "./qusdLedger";
import { getUsdcAtaBalanceUi, scanNewUsdcDeposits, type ScanLedger } from "./solanaUsdcScan";
import { ensureAccountsSchema } from "./ensureAccountsSchema";
import { getDepositScanIntervalMs, recordDepositScanTickComplete } from "./depositScanHealth";

type SqliteDb = InstanceType<typeof Database>;

export function openDepositDatabase(dbPath: string): SqliteDb {
  const database = new Database(dbPath);
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 8000");
  ensureAccountsSchema(database);
  return database;
}

function openSqlite(dbPath: string): SqliteDb {
  return openDepositDatabase(dbPath);
}

export function resolveDbPath(root: string, env: NodeJS.ProcessEnv): string {
  return env.SOLVEQUEST_DB_PATH?.trim() || path.join(root, "data", "solvequest.db");
}

export function rpcUrl(env: NodeJS.ProcessEnv): string {
  return (
    env.SOLANA_RPC_URL?.trim() ||
    env.SOLANA_RPC_PROXY_TARGET?.trim() ||
    "https://api.mainnet-beta.solana.com"
  );
}

/**
 * One full pass over all accounts with a deposit address (USDC scan → QUSD credit).
 * Opens and closes the DB for each run.
 */
export async function runQusdBuyScanOnce(
  root: string,
  env: NodeJS.ProcessEnv,
): Promise<{ ok: true; accountsScanned: number } | { ok: false; error: string }> {
  const dbPath = resolveDbPath(root, env);
  if (!fs.existsSync(dbPath)) {
    return { ok: false, error: `database missing at ${dbPath}` };
  }

  let database: SqliteDb;
  try {
    database = openSqlite(dbPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }

  const qusdPerUsdc = parseQusdMultiplier(env.QUSD_MULTIPLIER ?? env.VITE_QUSD_MULTIPLIER);
  const connection = new Connection(rpcUrl(env), "confirmed");

  try {
    let rows: { id: string; sol_receive_address: string }[];
    try {
      rows = database
        .prepare(
          `SELECT id, sol_receive_address FROM accounts
           WHERE sol_receive_address IS NOT NULL AND TRIM(sol_receive_address) != ''`,
        )
        .all() as { id: string; sol_receive_address: string }[];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }

    for (const { id: accountId, sol_receive_address: addr } of rows) {
      try {
        await processAccount(database, connection, accountId, addr, qusdPerUsdc, env);
      } catch (e) {
        console.error(`[qusd-buy] account ${accountId}:`, e);
      }
    }
    return { ok: true, accountsScanned: rows.length };
  } finally {
    try {
      database.close();
    } catch {
      /* ignore */
    }
  }
}

/** Opt-in background polling: set SOLVEQUEST_DEPOSIT_SCAN=1 (or true). Default is off. */
export function startQusdBuyScanWorker(root: string, env: NodeJS.ProcessEnv): void {
  const enabled = env.SOLVEQUEST_DEPOSIT_SCAN === "1" || env.SOLVEQUEST_DEPOSIT_SCAN === "true";
  if (!enabled) {
    console.log("[qusd-buy] background polling disabled (set SOLVEQUEST_DEPOSIT_SCAN=1 to enable)");
    return;
  }

  const qusdPerUsdc = parseQusdMultiplier(env.QUSD_MULTIPLIER ?? env.VITE_QUSD_MULTIPLIER);

  const dbPath = resolveDbPath(root, env);
  const intervalMs = getDepositScanIntervalMs(env);

  let db: SqliteDb | null = null;
  const getDb = (): SqliteDb | null => {
    if (db) return db;
    if (!fs.existsSync(dbPath)) {
      console.warn(`[qusd-buy] database missing at ${dbPath} — skipping worker`);
      return null;
    }
    try {
      db = openSqlite(dbPath);
      return db;
    } catch (e) {
      console.error("[qusd-buy] open db:", e);
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
      console.error("[qusd-buy] list accounts:", e);
      return;
    }

    for (const { id: accountId, sol_receive_address: addr } of rows) {
      try {
        await processAccount(database, connection, accountId, addr, qusdPerUsdc, env);
      } catch (e) {
        console.error(`[qusd-buy] account ${accountId}:`, e);
      }
    }
    recordDepositScanTickComplete();
  };

  void tick();
  setInterval(() => void tick(), intervalMs);
  console.log(
    `[qusd-buy] every ${intervalMs}ms → ${dbPath} (RPC ${rpcUrl(env).slice(0, 48)}…; QUSD_MULTIPLIER=${qusdPerUsdc})`,
  );
}

export async function processAccount(
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
    console.warn(`[qusd-buy] invalid sol_receive_address for ${accountId}`);
    return;
  }

  const wmRow = database
    .prepare(`SELECT watermark_signature FROM deposit_scan_state WHERE account_id = ?`)
    .get(accountId) as { watermark_signature: string | null } | undefined;

  const creditedBefore = database
    .prepare(
      `SELECT COALESCE(SUM(amount_human), 0) AS s FROM deposit_credits
       WHERE account_id = ? AND chain = 'solana' AND kind = 'usdc'`,
    )
    .get(accountId) as { s: number };

  let ledger: ScanLedger = {
    watermarkUsdcAta: wmRow?.watermark_signature ?? null,
  };

  /** Old bug: watermark advanced with zero credits — incremental scan then finds nothing new. */
  const onChainUi = await getUsdcAtaBalanceUi(connection, owner);
  const sumCredited = Number(creditedBefore?.s ?? 0);
  if (onChainUi > 1e-6 && sumCredited < 1e-6 && ledger.watermarkUsdcAta != null) {
    database.prepare(`DELETE FROM deposit_scan_state WHERE account_id = ?`).run(accountId);
    ledger = { watermarkUsdcAta: null };
    console.warn(
      `[qusd-buy] cleared stale watermark for ${accountId.slice(0, 8)}… (USDC on-chain, no deposit_credits)`,
    );
  }

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
        `[qusd-buy] credited ${accountId.slice(0, 8)}… +${qusd.toFixed(2)} QUSD (${amountUsdc} USDC) sig ${signature.slice(0, 10)}…`,
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
}
