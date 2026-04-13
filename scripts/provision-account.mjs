#!/usr/bin/env node
/**
 * Inserts a new accounts row with auto-generated Solana receive address.
 * Usage: node scripts/provision-account.mjs [path/to/db.sqlite]
 */
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { Keypair } from "@solana/web3.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outPath = process.argv[2] ?? path.join(root, "data", "solvequest.db");

const id = crypto.randomUUID();
const now = Date.now();
const solKp = Keypair.generate();
const solAddr = solKp.publicKey.toBase58();

const db = new Database(outPath);
try {
  for (const sql of [
    "ALTER TABLE accounts ADD COLUMN sol_receive_address TEXT",
    "ALTER TABLE accounts ADD COLUMN email TEXT",
  ]) {
    try {
      db.exec(sql);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("duplicate column")) throw e;
    }
  }

  try {
    db.exec("ALTER TABLE accounts ADD COLUMN sync_version INTEGER NOT NULL DEFAULT 0");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("duplicate column")) throw e;
  }

  const stmt = db.prepare(`
    INSERT INTO accounts (
      id, created_at, updated_at, label, email,
      usdc_balance, coverage_limit_qusd, premium_accrued_usdc, covered_losses_qusd, coverage_used_qusd,
      tier_id, qusd_unlocked, qusd_locked, accumulated_losses_qusd,
      bonus_repaid_usdc, vault_activity_at,
      sol_receive_address, sync_version
    ) VALUES (
      @id, @created_at, @updated_at, NULL, NULL,
      @usdc_balance, @coverage_limit_qusd, 0, 0, 0,
      @tier_id, @qusd_unlocked, 0, 0,
      0, NULL,
      @sol_receive_address, 0
    )
  `);
  stmt.run({
    id,
    created_at: now,
    updated_at: now,
    usdc_balance: 0,
    coverage_limit_qusd: 50_000,
    tier_id: 3,
    qusd_unlocked: 10_000,
    sol_receive_address: solAddr,
  });
  console.log(`OK: provisioned account ${id}`);
  console.log(`  Solana: ${solAddr}`);
} finally {
  db.close();
}
