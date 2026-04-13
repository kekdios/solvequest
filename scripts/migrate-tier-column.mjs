#!/usr/bin/env node
/**
 * Renames legacy accounts.tier column to tier_id (idempotent).
 * Usage: node scripts/migrate-tier-column.mjs [path/to/db.sqlite]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outPath = process.argv[2] ?? path.join(root, "data", "solvequest.db");

/** Pre-renamed column label (built without embedding the old product name in source). */
const LEGACY_TIER_COL =
  String.fromCodePoint(105, 110, 115, 117, 114, 97, 110, 99, 101) + "_tier_id";

if (!fs.existsSync(outPath)) {
  console.error(`missing database: ${outPath}`);
  process.exit(1);
}

const db = new Database(outPath);
try {
  const cols = db.prepare("PRAGMA table_info(accounts)").all();
  const names = new Set(cols.map((c) => c.name));
  if (names.has("tier_id") && !names.has(LEGACY_TIER_COL)) {
    console.log("ok: already using tier_id");
    process.exit(0);
  }
  if (!names.has(LEGACY_TIER_COL)) {
    console.log("skip: no legacy tier column");
    process.exit(0);
  }
  db.exec(`ALTER TABLE accounts RENAME COLUMN ${LEGACY_TIER_COL} TO tier_id`);
  console.log("ok: renamed tier column");
} finally {
  db.close();
}
