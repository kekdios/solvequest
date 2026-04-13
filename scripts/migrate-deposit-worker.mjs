#!/usr/bin/env node
/**
 * Adds sync_version, deposit_scan_state, unique sol_receive index (idempotent).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outPath = process.argv[2] ?? path.join(root, "data", "solvequest.db");

const db = new Database(outPath);
try {
  try {
    db.exec("ALTER TABLE accounts ADD COLUMN sync_version INTEGER NOT NULL DEFAULT 0");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("duplicate column")) throw e;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS deposit_credits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
      chain TEXT NOT NULL CHECK (chain IN ('solana')),
      signature TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('usdc', 'sol')),
      amount_human REAL,
      lamports INTEGER,
      credited_at INTEGER NOT NULL,
      UNIQUE (chain, signature)
    );
    CREATE INDEX IF NOT EXISTS idx_deposit_credits_account ON deposit_credits (account_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS deposit_scan_state (
      account_id TEXT PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
      watermark_signature TEXT
    );
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_sol_receive_unique
      ON accounts (sol_receive_address)
      WHERE sol_receive_address IS NOT NULL AND TRIM(sol_receive_address) != '';
  `);

  console.log(`OK: deposit worker migration applied ${outPath}`);
} finally {
  db.close();
}
