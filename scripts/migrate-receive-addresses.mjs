#!/usr/bin/env node
/**
 * Adds sol_receive_address to existing account DB files (legacy installs).
 * EVM columns are no longer used; run db/migrations/003_drop_evm_receive.sql if present.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outPath = process.argv[2] ?? path.join(root, "data", "solvequest.db");

const db = new Database(outPath);
try {
  for (const sql of ["ALTER TABLE accounts ADD COLUMN sol_receive_address TEXT"]) {
    try {
      db.exec(sql);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("duplicate column")) throw e;
    }
  }
  console.log(`OK: migration applied ${outPath}`);
} finally {
  db.close();
}
