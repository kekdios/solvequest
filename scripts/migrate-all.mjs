#!/usr/bin/env node
/**
 * Legacy migrations were removed after the ledger schema reset.
 * For a fresh database: `npm run db:init`
 * To replace an existing DB: back it up, delete it, then `npm run db:init`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outPath =
  process.argv[2]?.trim() ||
  process.env.SOLVEQUEST_DB_PATH?.trim() ||
  path.join(root, "data", "solvequest.db");

if (!fs.existsSync(outPath)) {
  console.error(`[migrate-all] No database at ${outPath} — run: npm run db:init`);
  process.exit(1);
}

console.log(
  `[migrate-all] No incremental migrations in this branch. If upgrading from an old schema, backup and delete the DB, then run: npm run db:init\nDatabase: ${outPath}\nOK.`,
);
