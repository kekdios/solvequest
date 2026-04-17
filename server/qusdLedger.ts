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

/** Spend QUSD for QUSD→USDC swap (server sends USDC from treasury). Idempotent per swap_id. */
export function insertQusdSwapSpend(
  database: SqliteDb,
  accountId: string,
  qusdAmount: number,
  swapId: string,
  at: number,
): void {
  if (qusdAmount <= 0) return;
  database
    .prepare(
      `INSERT OR IGNORE INTO qusd_ledger (account_id, created_at, entry_type, unlocked_delta, locked_delta, ref_type, ref_id)
       VALUES (?, ?, 'qusd_swap', ?, 0, 'swap', ?)`,
    )
    .run(accountId, at, -qusdAmount, swapId);
}

export function insertQusdSwapRefund(
  database: SqliteDb,
  accountId: string,
  qusdAmount: number,
  swapId: string,
  at: number,
): void {
  if (qusdAmount <= 0) return;
  database
    .prepare(
      `INSERT OR IGNORE INTO qusd_ledger (account_id, created_at, entry_type, unlocked_delta, locked_delta, ref_type, ref_id)
       VALUES (?, ?, 'qusd_swap_refund', ?, 0, 'swap_refund', ?)`,
    )
    .run(accountId, at, qusdAmount, swapId);
}

/** One lifetime daily-prize credit per account (idempotent via ref_id `lifetime`). */
export function insertDailyPrizeLedgerCredit(
  database: SqliteDb,
  accountId: string,
  qusdAmount: number,
  at: number,
): void {
  if (qusdAmount <= 0) return;
  database
    .prepare(
      `INSERT OR IGNORE INTO qusd_ledger (account_id, created_at, entry_type, unlocked_delta, locked_delta, ref_type, ref_id)
       VALUES (?, ?, 'daily_prize', ?, 0, 'daily_prize', 'lifetime')`,
    )
    .run(accountId, at, qusdAmount);
}

/** Manual admin credit; `refId` must be unique per grant (e.g. UUID). */
export function insertAdminQusdGrant(
  database: SqliteDb,
  accountId: string,
  qusdAmount: number,
  at: number,
  refId: string,
): void {
  if (!Number.isFinite(qusdAmount) || qusdAmount <= 0) return;
  database
    .prepare(
      `INSERT INTO qusd_ledger (account_id, created_at, entry_type, unlocked_delta, locked_delta, ref_type, ref_id)
       VALUES (?, ?, 'admin_grant', ?, 0, 'admin_grant', ?)`,
    )
    .run(accountId, at, qusdAmount, refId);
}

