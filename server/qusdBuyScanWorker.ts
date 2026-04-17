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

/** Optional hook for admin UI / logs (one line per call). */
export type DepositScanReporter = {
  log: (line: string) => void;
};

export type DepositScanAccountReport = {
  account_id: string;
  sol_receive_address: string;
  /** Completed scan; `skipped` = invalid address or early exit without throwing. */
  status: "ok" | "error" | "skipped";
  error?: string;
  lines: string[];
};

export type RunQusdBuyScanOnceOptions = {
  /** When true, returns per-account `reports` with step lines and errors. */
  verbose?: boolean;
};

/**
 * One full pass over all accounts with a deposit address (USDC scan → QUSD credit).
 * Opens and closes the DB for each run.
 */
export async function runQusdBuyScanOnce(
  root: string,
  env: NodeJS.ProcessEnv,
  options?: RunQusdBuyScanOnceOptions,
): Promise<
  | { ok: true; accountsScanned: number; reports?: DepositScanAccountReport[] }
  | { ok: false; error: string }
> {
  const verbose = options?.verbose === true;
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

  const reports: DepositScanAccountReport[] = [];

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
      const lines: string[] = [];
      const reporter: DepositScanReporter | undefined = verbose
        ? { log: (line: string) => lines.push(line) }
        : undefined;
      try {
        const outcome = await processAccount(database, connection, accountId, addr, qusdPerUsdc, env, reporter);
        if (verbose) {
          reports.push({
            account_id: accountId,
            sol_receive_address: addr.trim(),
            status: outcome === "skipped" ? "skipped" : "ok",
            lines,
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[qusd-buy] account ${accountId}:`, e);
        if (verbose) {
          lines.push(`Error: ${msg}`);
          reports.push({
            account_id: accountId,
            sol_receive_address: addr.trim(),
            status: "error",
            error: msg,
            lines,
          });
        }
      }
    }
    return { ok: true, accountsScanned: rows.length, reports: verbose ? reports : undefined };
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
        await processAccount(database, connection, accountId, addr, qusdPerUsdc, env, undefined);
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

/** `skipped` = invalid address (nothing to do). */
export async function processAccount(
  database: SqliteDb,
  connection: Connection,
  accountId: string,
  solReceiveAddress: string,
  qusdPerUsdc: number,
  env: NodeJS.ProcessEnv,
  reporter?: DepositScanReporter,
): Promise<"completed" | "skipped"> {
  let owner: PublicKey;
  try {
    owner = new PublicKey(solReceiveAddress.trim());
  } catch {
    console.warn(`[qusd-buy] invalid sol_receive_address for ${accountId}`);
    reporter?.log("Skipped: sol_receive_address is not a valid Solana public key.");
    return "skipped";
  }

  reporter?.log(
    `User's verified Solana receive address (from their Account; USDC deposits go here): ${owner.toBase58()}`,
  );
  reporter?.log(`QUSD per 1 USDC (multiplier): ${qusdPerUsdc}`);

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
  reporter?.log(`On-chain USDC balance (canonical ATA): ${onChainUi.toFixed(6)} USDC`);
  const sumCredited = Number(creditedBefore?.s ?? 0);
  reporter?.log(`Prior USDC total credited (deposit_credits): ${sumCredited.toFixed(6)}`);
  reporter?.log(
    ledger.watermarkUsdcAta
      ? `Scan watermark signature: ${ledger.watermarkUsdcAta.slice(0, 16)}…`
      : "Scan watermark: none (full history pagination from chain)",
  );
  if (onChainUi > 1e-6 && sumCredited < 1e-6 && ledger.watermarkUsdcAta != null) {
    database.prepare(`DELETE FROM deposit_scan_state WHERE account_id = ?`).run(accountId);
    ledger = { watermarkUsdcAta: null };
    console.warn(
      `[qusd-buy] cleared stale watermark for ${accountId.slice(0, 8)}… (USDC on-chain, no deposit_credits)`,
    );
    reporter?.log(
      "Cleared stale watermark (USDC on-chain but no deposit_credits rows) — rescanning from older signatures.",
    );
  }

  reporter?.log("Fetching new USDC transfers from chain…");
  const { credits, ledger: next } = await scanNewUsdcDeposits(connection, owner, ledger);
  reporter?.log(`Parsed ${credits.length} new deposit(s) not yet credited.`);

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
    reporter?.log(
      `Ledger: apply ${c.amountUsdc.toFixed(6)} USDC · sig ${c.signature.slice(0, 18)}…`,
    );
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
  reporter?.log(
    next.watermarkUsdcAta
      ? `Saved scan watermark: ${next.watermarkUsdcAta.slice(0, 20)}…`
      : "Saved scan watermark: (none)",
  );
  reporter?.log("Account pass complete.");
  return "completed";
}
