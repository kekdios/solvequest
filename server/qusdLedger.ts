/**
 * Append-only QUSD ledger: balances are SUM(unlocked_delta), SUM(locked_delta).
 */
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

type SqliteDb = InstanceType<typeof Database>;

export const SIGNUP_GRANT_QUSD = 10_000;

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

/** Vault lock/unlock / client reconciliation: conservation unlocked+locked when possible. */
export function insertVaultMove(
  database: SqliteDb,
  accountId: string,
  unlockedDelta: number,
  lockedDelta: number,
  at: number,
): void {
  if (Math.abs(unlockedDelta) < 1e-12 && Math.abs(lockedDelta) < 1e-12) return;
  database
    .prepare(
      `INSERT INTO qusd_ledger (account_id, created_at, entry_type, unlocked_delta, locked_delta, ref_type, ref_id)
       VALUES (?, ?, 'vault_move', ?, ?, 'vault', ?)`,
    )
    .run(accountId, at, unlockedDelta, lockedDelta, `move_${randomUUID()}`);
}

export function insertLockedVaultInterest(
  database: SqliteDb,
  accountId: string,
  lockedDelta: number,
  at: number,
): void {
  if (lockedDelta <= 0) return;
  database
    .prepare(
      `INSERT INTO qusd_ledger (account_id, created_at, entry_type, unlocked_delta, locked_delta, ref_type, ref_id)
       VALUES (?, ?, 'vault_interest', 0, ?, 'vault_interest', ?)`,
    )
    .run(accountId, at, lockedDelta, `interest_${randomUUID()}`);
}
