/**
 * Adds custodial_derivation_index + unique index for HD Solana deposit addresses.
 * Same logic as server startup (`ensureCustodialHdSchema`). Safe to re-run.
 * Usage: npm run db:migrate-hd [path/to/db.sqlite]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { ensureCustodialHdSchema } from "../server/ensureCustodialHdSchema";

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
  ensureCustodialHdSchema(db);
  console.log("[migrate-custodial-hd] OK:", outPath);
} finally {
  db.close();
}
