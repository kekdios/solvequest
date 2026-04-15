#!/usr/bin/env node
/**
 * Inserts a new account row + QUSD bonus + random Solana pubkey (dev provisioning only).
 * Usage: npx tsx scripts/provision-account.ts [path/to/db.sqlite]
 */
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import { Keypair } from "@solana/web3.js";
import { ensureCustodialHdSchema } from "../server/ensureCustodialHdSchema";
import {
  ADDRESS_VERIFICATION_BONUS_QUSD,
  EMAIL_OTP_VERIFICATION_BONUS_QUSD,
  SIGNUP_GRANT_QUSD,
} from "../server/qusdLedger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
dotenv.config({ path: path.join(root, ".env") });

const outPath = process.argv[2]?.trim() || path.join(root, "data", "solvequest.db");

const id = crypto.randomUUID();
const now = Date.now();

const db = new Database(outPath);
try {
  ensureCustodialHdSchema(db);
  const kp = Keypair.generate();
  const solAddr = kp.publicKey.toBase58();

  db.prepare(
    `INSERT INTO accounts (
      id, created_at, updated_at, email,
      usdc_balance, coverage_limit_qusd, premium_accrued_usdc, covered_losses_qusd, coverage_used_qusd,
      tier_id, accumulated_losses_qusd, bonus_repaid_usdc, vault_activity_at, qusd_vault_interest_at, sync_version,
      sol_receive_address, sol_receive_verified_at
    ) VALUES (
      @id, @created_at, @updated_at, NULL,
      0, @coverage_limit_qusd, 0, 0, 0,
      @tier_id, 0, 0, NULL, NULL, 0,
      @sol_receive_address, @sol_receive_verified_at
    )`,
  ).run({
    id,
    created_at: now,
    updated_at: now,
    coverage_limit_qusd: 50_000,
    tier_id: 3,
    sol_receive_address: solAddr,
    sol_receive_verified_at: now,
  });
  db.prepare(
    `INSERT INTO qusd_ledger (account_id, created_at, entry_type, unlocked_delta, locked_delta, ref_type, ref_id)
     VALUES (?, ?, 'signup_grant', ?, 0, 'signup', 'grant')`,
  ).run(id, now, SIGNUP_GRANT_QUSD);
  db.prepare(
    `INSERT INTO qusd_ledger (account_id, created_at, entry_type, unlocked_delta, locked_delta, ref_type, ref_id)
     VALUES (?, ?, 'email_otp_bonus', ?, 0, 'email_otp', 'first_verify')`,
  ).run(id, now, EMAIL_OTP_VERIFICATION_BONUS_QUSD);
  db.prepare(
    `INSERT INTO qusd_ledger (account_id, created_at, entry_type, unlocked_delta, locked_delta, ref_type, ref_id)
     VALUES (?, ?, 'address_verify_bonus', ?, 0, 'address_verify', 'bonus')`,
  ).run(id, now, ADDRESS_VERIFICATION_BONUS_QUSD);
  console.log(`OK: provisioned account ${id}`);
  console.log(`  Solana (dev keypair — fund this address to test deposits): ${solAddr}`);
} finally {
  db.close();
}
