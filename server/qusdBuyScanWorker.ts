/**
 * Buy QUSD (Solana): poll mainnet for USDC SPL **inbound to the shared treasury USDC ATA**,
 * resolve the **sender** wallet, match `accounts.sol_receive_address`, append `deposit_credits` + `qusd_ledger`.
 */
import fs from "node:fs";
import path from "node:path";
import { Connection, PublicKey } from "@solana/web3.js";
import Database from "better-sqlite3";
import { parseQusdMultiplier } from "../src/lib/qusdMultiplier";
import { insertSolanaUsdcCredit } from "./qusdLedger";
import { scanTreasuryInboundDeposits, type TreasuryScanLedger } from "./treasuryUsdcDepositScan";
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

/**
 * JSON-RPC base URL for deposit scans (and this module’s `Connection`).
 * Order: **`SOLANA_RPC_URL`** (dedicated / paid / alternate node — use as primary when set) →
 * **`SOLANA_RPC_PROXY_TARGET`** (same as Express `/solana-rpc` upstream, if set) → public mainnet-beta.
 * There is no automatic retry switching between URLs; set **`SOLANA_RPC_URL`** to avoid public-RPC 429s.
 */
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
 * Shared USDC “treasury” receive wallet: **SWAP_USDC_RECEIVE_ADDRESS** (buy-QUSD deposit target), else **SOLANA_TREASURY_ADDRESS**.
 */
export function resolveUsdcDepositTreasuryOwner(env: NodeJS.ProcessEnv): PublicKey | null {
  const raw =
    env.SWAP_USDC_RECEIVE_ADDRESS?.trim() || env.SOLANA_TREASURY_ADDRESS?.trim() || "";
  if (!raw) return null;
  try {
    return new PublicKey(raw);
  } catch {
    return null;
  }
}

/**
 * One full pass: scan treasury USDC ATA → attribute by sender → QUSD credit.
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
  const treasuryOwner = resolveUsdcDepositTreasuryOwner(env);

  const reports: DepositScanAccountReport[] = [];

  try {
    if (!treasuryOwner) {
      const msg =
        "Set SWAP_USDC_RECEIVE_ADDRESS or SOLANA_TREASURY_ADDRESS so USDC deposits can be scanned.";
      console.warn(`[qusd-buy] ${msg}`);
      if (verbose) {
        reports.push({
          account_id: "_treasury",
          sol_receive_address: "",
          status: "skipped",
          error: msg,
          lines: [msg],
        });
      }
      return { ok: true, accountsScanned: 0, reports: verbose ? reports : undefined };
    }

    const lines: string[] = [];
    const reporter: DepositScanReporter | undefined = verbose
      ? { log: (line: string) => lines.push(line) }
      : undefined;

    let creditsApplied = 0;
    try {
      creditsApplied = await processTreasuryDepositSweep(
        database,
        connection,
        treasuryOwner,
        qusdPerUsdc,
        reporter,
      );
      if (verbose) {
        reports.push({
          account_id: "_treasury",
          sol_receive_address: treasuryOwner.toBase58(),
          status: "ok",
          lines,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[qusd-buy] treasury sweep:", e);
      if (verbose) {
        lines.push(`Error: ${msg}`);
        reports.push({
          account_id: "_treasury",
          sol_receive_address: treasuryOwner.toBase58(),
          status: "error",
          error: msg,
          lines,
        });
      }
      return { ok: false, error: msg };
    }

    return { ok: true, accountsScanned: creditsApplied, reports: verbose ? reports : undefined };
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

    const treasuryOwner = resolveUsdcDepositTreasuryOwner(env);
    if (!treasuryOwner) {
      console.warn(
        "[qusd-buy] SWAP_USDC_RECEIVE_ADDRESS / SOLANA_TREASURY_ADDRESS unset — skipping sweep tick",
      );
      return;
    }

    try {
      await processTreasuryDepositSweep(database, connection, treasuryOwner, qusdPerUsdc, undefined);
    } catch (e) {
      console.error("[qusd-buy] treasury sweep:", e);
    }
    recordDepositScanTickComplete();
  };

  void tick();
  setInterval(() => void tick(), intervalMs);
  console.log(
    `[qusd-buy] every ${intervalMs}ms → ${dbPath} (RPC ${rpcUrl(env).slice(0, 48)}…; QUSD_MULTIPLIER=${qusdPerUsdc})`,
  );
}

async function processTreasuryDepositSweep(
  database: SqliteDb,
  connection: Connection,
  treasuryOwner: PublicKey,
  qusdPerUsdc: number,
  reporter?: DepositScanReporter,
): Promise<number> {
  const wmRow = database
    .prepare(`SELECT watermark_signature FROM deposit_treasury_scan WHERE id = 1`)
    .get() as { watermark_signature: string | null } | undefined;

  const ledger: TreasuryScanLedger = {
    watermarkSignature: wmRow?.watermark_signature ?? null,
  };

  reporter?.log(
    `Treasury USDC receive wallet: ${treasuryOwner.toBase58()} (SWAP_USDC_RECEIVE_ADDRESS or SOLANA_TREASURY_ADDRESS)`,
  );
  reporter?.log(`QUSD per 1 USDC (multiplier): ${qusdPerUsdc}`);

  const { deposits, ledger: next } = await scanTreasuryInboundDeposits(connection, treasuryOwner, ledger);
  reporter?.log(`Inbound transfers with resolved sender (this batch): ${deposits.length}`);

  const lookupAccount = database.prepare(
    `SELECT id FROM accounts WHERE TRIM(COALESCE(sol_receive_address, '')) = ?`,
  );

  const now = Date.now();
  let creditsApplied = 0;

  const insCredit = database.prepare(
    `INSERT OR IGNORE INTO deposit_credits (account_id, chain, signature, kind, amount_human, credited_at)
     VALUES (?, 'solana', ?, 'usdc', ?, ?)`,
  );

  for (const d of deposits) {
    const senderStr = d.sender.toBase58();
    const row = lookupAccount.get(senderStr) as { id: string } | undefined;
    if (!row) {
      reporter?.log(
        `No linked account for sender ${senderStr} — skipped (sig ${d.signature.slice(0, 16)}…)`,
      );
      continue;
    }

    try {
      const r = insCredit.run(row.id, d.signature, d.amountUsdc, now);
      if (r.changes === 0) {
        reporter?.log(`Duplicate or ignored signature ${d.signature.slice(0, 16)}…`);
        continue;
      }
      const qusd = d.amountUsdc * qusdPerUsdc;
      insertSolanaUsdcCredit(database, row.id, qusd, d.signature, now);
      database
        .prepare(`UPDATE accounts SET sync_version = sync_version + 1, updated_at = ? WHERE id = ?`)
        .run(now, row.id);
      creditsApplied += 1;
      console.log(
        `[qusd-buy] treasury +${qusd.toFixed(2)} QUSD (${d.amountUsdc} USDC) → ${row.id.slice(0, 8)}… sig ${d.signature.slice(0, 10)}…`,
      );
      reporter?.log(
        `Credited ${d.amountUsdc.toFixed(6)} USDC → account ${row.id.slice(0, 8)}… (sender ${senderStr.slice(0, 8)}…)`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE") || msg.includes("constraint")) {
        reporter?.log(`Constraint on ${d.signature.slice(0, 16)}… — ${msg}`);
        continue;
      }
      throw e;
    }
  }

  database
    .prepare(
      `INSERT INTO deposit_treasury_scan (id, watermark_signature)
       VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET watermark_signature = excluded.watermark_signature`,
    )
    .run(next.watermarkSignature);

  reporter?.log(
    next.watermarkSignature
      ? `Saved watermark ${next.watermarkSignature.slice(0, 24)}…`
      : "Saved watermark (none)",
  );
  reporter?.log("Treasury sweep complete.");

  return creditsApplied;
}
