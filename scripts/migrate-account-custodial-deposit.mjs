#!/usr/bin/env node
/**
 * Adds accounts.custodial_seckey_enc for server-side per-account Solana deposit key (AES-GCM blob).
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
    db.exec("ALTER TABLE accounts ADD COLUMN custodial_seckey_enc TEXT");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("duplicate column")) throw e;
  }
  console.log(`OK: custodial deposit column migration applied ${outPath}`);
} finally {
  db.close();
}
