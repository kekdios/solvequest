#!/usr/bin/env node
/**
 * Inserts a new account row + signup QUSD ledger + HD-derived Solana deposit address (same scheme as ensure-custodial-deposit).
 * Env: SOLANA_CUSTODIAL_MASTER_KEY_B64 (server-only)
 * Usage: npx tsx scripts/provision-account.ts [path/to/db.sqlite]
 */
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import {
  deriveCustodialKeypairFromIndex,
  RESERVED_SWEEP_FEE_PAYER_DERIVATION_INDEX,
} from "../server/custodialHdDerive";
import { ensureCustodialHdSchema } from "../server/ensureCustodialHdSchema";

const SIGNUP_GRANT = 10_000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
dotenv.config({ path: path.join(root, ".env") });

const outPath = process.argv[2]?.trim() || path.join(root, "data", "solvequest.db");

const id = crypto.randomUUID();
const now = Date.now();

const db = new Database(outPath);
try {
  ensureCustodialHdSchema(db);
  const maxRow = db
    .prepare(`SELECT COALESCE(MAX(custodial_derivation_index), -1) AS m FROM accounts`)
    .get() as { m: number };
  let nextIndex = maxRow.m + 1;
  if (nextIndex === RESERVED_SWEEP_FEE_PAYER_DERIVATION_INDEX) {
    nextIndex += 1;
  }
  const kp = deriveCustodialKeypairFromIndex(nextIndex, process.env);
  const solAddr = kp.publicKey.toBase58();

  db.prepare(
    `INSERT INTO accounts (
      id, created_at, updated_at, email,
      usdc_balance, coverage_limit_qusd, premium_accrued_usdc, covered_losses_qusd, coverage_used_qusd,
      tier_id, accumulated_losses_qusd, bonus_repaid_usdc, vault_activity_at, qusd_vault_interest_at, sync_version,
      sol_receive_address, custodial_derivation_index
    ) VALUES (
      @id, @created_at, @updated_at, NULL,
      0, @coverage_limit_qusd, 0, 0, 0,
      @tier_id, 0, 0, NULL, NULL, 0,
      @sol_receive_address, @custodial_derivation_index
    )`,
  ).run({
    id,
    created_at: now,
    updated_at: now,
    coverage_limit_qusd: 50_000,
    tier_id: 3,
    sol_receive_address: solAddr,
    custodial_derivation_index: nextIndex,
  });
  db.prepare(
    `INSERT INTO qusd_ledger (account_id, created_at, entry_type, unlocked_delta, locked_delta, ref_type, ref_id)
     VALUES (?, ?, 'signup_grant', ?, 0, 'signup', 'grant')`,
  ).run(id, now, SIGNUP_GRANT);
  console.log(`OK: provisioned account ${id}`);
  console.log(`  HD index: ${nextIndex}`);
  console.log(`  Solana: ${solAddr}`);
} finally {
  db.close();
}
