#!/usr/bin/env node
/**
 * Adds bonus_repaid_usdc, vault_activity_at, perp_open_positions (idempotent).
 * Usage: node scripts/migrate-account-sync-state.mjs [path/to/db.sqlite]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outPath = process.argv[2] ?? path.join(root, "data", "solvequest.db");

if (!fs.existsSync(outPath)) {
  console.error(`missing database: ${outPath}`);
  process.exit(1);
}

const db = new Database(outPath);
try {
  let names = new Set(db.prepare("PRAGMA table_info(accounts)").all().map((c) => c.name));
  if (!names.has("bonus_repaid_usdc")) {
    db.exec(`ALTER TABLE accounts ADD COLUMN bonus_repaid_usdc REAL NOT NULL DEFAULT 0`);
    console.log("ok: added accounts.bonus_repaid_usdc");
    names = new Set(db.prepare("PRAGMA table_info(accounts)").all().map((c) => c.name));
  } else {
    console.log("skip: bonus_repaid_usdc exists");
  }
  if (!names.has("vault_activity_at")) {
    db.exec(`ALTER TABLE accounts ADD COLUMN vault_activity_at INTEGER`);
    console.log("ok: added accounts.vault_activity_at");
  } else {
    console.log("skip: vault_activity_at exists");
  }

  const migrationSql = fs.readFileSync(
    path.join(root, "db", "migrations", "005_account_state_and_open_perps.sql"),
    "utf8",
  );
  db.exec(migrationSql);
  console.log("ok: perp_open_positions table ensured");
} finally {
  db.close();
}
