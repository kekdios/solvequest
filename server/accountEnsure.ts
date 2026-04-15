/**
 * Shared SQLite account row creation for email (signup grant on first insert).
 * Used by account API and auth OTP success so ordering stays consistent.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import type Database from "better-sqlite3";
import { insertSignupGrant } from "./qusdLedger";

type SqliteDb = InstanceType<typeof Database>;

const DEFAULT_TIER_ID = 3;
const DEFAULT_COVERAGE_LIMIT_QUSD = 50_000;

export function resolveSolvequestDbPath(root: string, env: Record<string, string>): string {
  return env.SOLVEQUEST_DB_PATH?.trim() || path.join(root, "data", "solvequest.db");
}

/**
 * Ensures an `accounts` row exists for this email. New rows receive the signup QUSD grant.
 */
export function ensureAccountRowForEmail(database: SqliteDb, email: string): { accountId: string; created: boolean } {
  const emailNorm = email.toLowerCase();
  const existing = database
    .prepare(`SELECT id FROM accounts WHERE email = ?`)
    .get(emailNorm) as { id: string } | undefined;
  if (existing) {
    database.prepare(`UPDATE accounts SET updated_at = ? WHERE id = ?`).run(Date.now(), existing.id);
    return { accountId: existing.id, created: false };
  }
  const now = Date.now();
  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO accounts (
        id, created_at, updated_at, email,
        usdc_balance, coverage_limit_qusd, premium_accrued_usdc, covered_losses_qusd, coverage_used_qusd,
        tier_id, accumulated_losses_qusd, bonus_repaid_usdc, vault_activity_at, qusd_vault_interest_at, sync_version
      ) VALUES (?, ?, ?, ?, 0, ?, 0, 0, 0, ?, 0, 0, NULL, NULL, 0)`,
    )
    .run(id, now, now, emailNorm, DEFAULT_COVERAGE_LIMIT_QUSD, DEFAULT_TIER_ID);
  insertSignupGrant(database, id, now);
  return { accountId: id, created: true };
}
