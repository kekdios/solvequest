#!/usr/bin/env node
/**
 * Adds custodial_derivation_index + unique index for HD Solana deposit addresses.
 * Safe to run once on existing DBs. Usage: node scripts/migrate-custodial-hd.mjs [path/to/db.sqlite]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outPath =
  process.argv[2]?.trim() ||
  process.env.SOLVEQUEST_DB_PATH?.trim() ||
  path.join(root, "data", "solvequest.db");

if (!fs.existsSync(outPath)) {
  console.error(`[migrate-custodial-hd] No database at ${outPath}`);
  process.exit(1);
}

const db = new Database(outPath);
try {
  const cols = db.prepare(`PRAGMA table_info(accounts)`).all();
  const has = cols.some((c) => c.name === "custodial_derivation_index");
  if (!has) {
    db.exec(`ALTER TABLE accounts ADD COLUMN custodial_derivation_index INTEGER;`);
    console.log("[migrate-custodial-hd] Added column custodial_derivation_index");
  } else {
    console.log("[migrate-custodial-hd] Column custodial_derivation_index already present");
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_custodial_derivation_unique
      ON accounts (custodial_derivation_index)
      WHERE custodial_derivation_index IS NOT NULL;
  `);
  console.log("[migrate-custodial-hd] OK:", outPath);
} finally {
  db.close();
}
