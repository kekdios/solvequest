/**
 * Append-only QUSD ledger: balances are SUM(unlocked_delta), SUM(locked_delta).
 */
import type Database from "better-sqlite3";

type SqliteDb = InstanceType<typeof Database>;

export const SIGNUP_GRANT_QUSD = 10_000;
/** One-time credit after the user verifies their own Solana address on-chain. */
export const ADDRESS_VERIFICATION_BONUS_QUSD = 10_000;
/** One-time credit after the first successful email OTP verification. */
export const EMAIL_OTP_VERIFICATION_BONUS_QUSD = 10_000;

export function getLedgerBalances(
  database: SqliteDb,
  accountId: string,
): { unlocked: number; locked: number } {
  const row = database
    .prepare(
      `SELECT COALESCE(SUM(unlocked_delta), 0) AS u, COALESCE(SUM(locked_delta), 0) AS l
       FROM qusd_ledger WHERE account_id = ?`,
    )
    .get(accountId) as { u: number; l: number } | undefined;
  return {
    unlocked: Number(row?.u ?? 0),
    locked: Number(row?.l ?? 0),
  };
}

export function insertSignupGrant(database: SqliteDb, accountId: string, at: number): void {
  database
    .prepare(
      `INSERT OR IGNORE INTO qusd_ledger (account_id, created_at, entry_type, unlocked_delta, locked_delta, ref_type, ref_id)
       VALUES (?, ?, 'signup_grant', ?, 0, 'signup', 'grant')`,
    )
    .run(accountId, at, SIGNUP_GRANT_QUSD);
}

/** Idempotent: first successful email OTP only (same ref for all accounts — uniqueness is per account_id in index). */
export function insertEmailOtpVerificationBonus(database: SqliteDb, accountId: string, at: number): void {
  database
    .prepare(
      `INSERT OR IGNORE INTO qusd_ledger (account_id, created_at, entry_type, unlocked_delta, locked_delta, ref_type, ref_id)
       VALUES (?, ?, 'email_otp_bonus', ?, 0, 'email_otp', 'first_verify')`,
    )
    .run(accountId, at, EMAIL_OTP_VERIFICATION_BONUS_QUSD);
}

/** Idempotent: one bonus per account (registration reward after address verification). */
export function insertAddressVerificationBonus(database: SqliteDb, accountId: string, at: number): void {
  database
    .prepare(
      `INSERT OR IGNORE INTO qusd_ledger (account_id, created_at, entry_type, unlocked_delta, locked_delta, ref_type, ref_id)
       VALUES (?, ?, 'address_verify_bonus', ?, 0, 'address_verify', 'bonus')`,
    )
    .run(accountId, at, ADDRESS_VERIFICATION_BONUS_QUSD);
}

export function insertSolanaUsdcCredit(
  database: SqliteDb,
  accountId: string,
  qusdAmount: number,
  signature: string,
  at: number,
): void {
  database
    .prepare(
      `INSERT OR IGNORE INTO qusd_ledger (account_id, created_at, entry_type, unlocked_delta, locked_delta, ref_type, ref_id)
       VALUES (?, ?, 'solana_usdc', ?, 0, 'deposit_sig', ?)`,
    )
    .run(accountId, at, qusdAmount, signature);
}

export function insertPerpMarginLock(
  database: SqliteDb,
  accountId: string,
  positionId: string,
  marginUsdc: number,
  at: number,
): void {
  if (marginUsdc <= 0) return;
  database
    .prepare(
      `INSERT OR IGNORE INTO qusd_ledger (account_id, created_at, entry_type, unlocked_delta, locked_delta, ref_type, ref_id)
       VALUES (?, ?, 'perp_open', ?, 0, 'perp_open', ?)`,
    )
    .run(accountId, at, -marginUsdc, positionId);
}

export function insertPerpCloseSettlement(
  database: SqliteDb,
  accountId: string,
  positionId: string,
  creditUnlocked: number,
  at: number,
): void {
  database
    .prepare(
      `INSERT OR IGNORE INTO qusd_ledger (account_id, created_at, entry_type, unlocked_delta, locked_delta, ref_type, ref_id)
       VALUES (?, ?, 'perp_close', ?, 0, 'perp_close', ?)`,
    )
    .run(accountId, at, creditUnlocked, positionId);
}

/** Spend QUSD to buy QUEST (server sends QUEST on-chain). Idempotent per buy_id. */
export function insertQuestPurchaseSpend(
  database: SqliteDb,
  accountId: string,
  qusdAmount: number,
  buyId: string,
  at: number,
): void {
  if (qusdAmount <= 0) return;
  database
    .prepare(
      `INSERT OR IGNORE INTO qusd_ledger (account_id, created_at, entry_type, unlocked_delta, locked_delta, ref_type, ref_id)
       VALUES (?, ?, 'quest_purchase', ?, 0, 'quest_buy', ?)`,
    )
    .run(accountId, at, -qusdAmount, buyId);
}

/** Refund QUSD when QUEST transfer failed after a debit. */
export function insertQuestPurchaseRefund(
  database: SqliteDb,
  accountId: string,
  qusdAmount: number,
  buyId: string,
  at: number,
): void {
  if (qusdAmount <= 0) return;
  database
    .prepare(
      `INSERT OR IGNORE INTO qusd_ledger (account_id, created_at, entry_type, unlocked_delta, locked_delta, ref_type, ref_id)
       VALUES (?, ?, 'quest_purchase_refund', ?, 0, 'quest_buy_refund', ?)`,
    )
    .run(accountId, at, qusdAmount, buyId);
}

