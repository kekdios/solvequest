#!/usr/bin/env node
/**
 * Adds `email` + unique index to existing insured.db (idempotent).
 * Usage: node scripts/migrate-add-email-to-accounts.mjs [path/to/db.sqlite]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outPath = process.argv[2] ?? path.join(root, "data", "insured.db");

if (!fs.existsSync(outPath)) {
  console.error(`No database at ${outPath} — run npm run db:init first`);
  process.exit(1);
}

const db = new Database(outPath);
try {
  try {
    db.exec("ALTER TABLE accounts ADD COLUMN email TEXT");
    console.log("Added column: accounts.email");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("duplicate column")) throw e;
    console.log("Column accounts.email already exists — skip add");
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email ON accounts (email) WHERE email IS NOT NULL;
  `);
  console.log("OK: migration complete");
} finally {
  db.close();
}
