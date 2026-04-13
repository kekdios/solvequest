#!/usr/bin/env node
/**
 * Inserts a new account row + signup QUSD ledger + Solana receive address.
 * Usage: node scripts/provision-account.mjs [path/to/db.sqlite]
 */
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { Keypair } from "@solana/web3.js";

const SIGNUP_GRANT = 10_000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outPath = process.argv[2] ?? path.join(root, "data", "solvequest.db");

const id = crypto.randomUUID();
const now = Date.now();
const solKp = Keypair.generate();
const solAddr = solKp.publicKey.toBase58();

const db = new Database(outPath);
try {
  db.prepare(
    `INSERT INTO accounts (
      id, created_at, updated_at, email,
      usdc_balance, coverage_limit_qusd, premium_accrued_usdc, covered_losses_qusd, coverage_used_qusd,
      tier_id, accumulated_losses_qusd, bonus_repaid_usdc, vault_activity_at, qusd_vault_interest_at, sync_version,
      sol_receive_address
    ) VALUES (
      @id, @created_at, @updated_at, NULL,
      0, @coverage_limit_qusd, 0, 0, 0,
      @tier_id, 0, 0, NULL, NULL, 0,
      @sol_receive_address
    )`,
  ).run({
    id,
    created_at: now,
    updated_at: now,
    coverage_limit_qusd: 50_000,
    tier_id: 3,
    sol_receive_address: solAddr,
  });
  db.prepare(
    `INSERT INTO qusd_ledger (account_id, created_at, entry_type, unlocked_delta, locked_delta, ref_type, ref_id)
     VALUES (?, ?, 'signup_grant', ?, 0, 'signup', 'grant')`,
  ).run(id, now, SIGNUP_GRANT);
  console.log(`OK: provisioned account ${id}`);
  console.log(`  Solana: ${solAddr}`);
} finally {
  db.close();
}
