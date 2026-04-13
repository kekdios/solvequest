#!/usr/bin/env node
/**
 * Unique (account_id, position_id) for close rows — enables INSERT OR IGNORE idempotency.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outPath = process.argv[2] ?? path.join(root, "data", "solvequest.db");

const db = new Database(outPath);
try {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_perp_txn_close_once
    ON perp_transactions (account_id, position_id)
    WHERE txn_type = 'close';
  `);
  console.log(`OK: perp close unique index ${outPath}`);
} finally {
  db.close();
}
