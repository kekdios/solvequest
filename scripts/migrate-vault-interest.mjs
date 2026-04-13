#!/usr/bin/env node
/**
 * Adds accounts.qusd_vault_interest_at for server-side locked QUSD compounding (idempotent).
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
    db.exec("ALTER TABLE accounts ADD COLUMN qusd_vault_interest_at INTEGER");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("duplicate column")) throw e;
  }

  const now = Date.now();
  db.prepare(`UPDATE accounts SET qusd_vault_interest_at = ? WHERE qusd_vault_interest_at IS NULL`).run(now);

  console.log(`OK: vault interest checkpoint migration applied ${outPath}`);
} finally {
  db.close();
}
