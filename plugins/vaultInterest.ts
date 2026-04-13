/**
 * Server-side locked QUSD interest: compound on locked balance from ledger SUM,
 * append `vault_interest` ledger rows.
 */
import type Database from "better-sqlite3";
import { QUSD_INTEREST_PER_MINUTE_FACTOR } from "../src/engine/qusdVault";
import { getLedgerBalances, insertLockedVaultInterest } from "../server/qusdLedger";

type SqliteDb = InstanceType<typeof Database>;

const MS_PER_MINUTE = 60_000;

export function compoundLockedForFullMinutes(locked: number, fullMinutes: number): number {
  if (locked <= 0 || fullMinutes <= 0) return locked;
  const factor = 1 + QUSD_INTEREST_PER_MINUTE_FACTOR;
  return locked * factor ** fullMinutes;
}

/**
 * Applies accrued interest when `locked > 0` (from ledger) and at least one full minute
 * has passed since `qusd_vault_interest_at`. Bumps `sync_version` when locked changes.
 */
export function applyLockedQusdInterest(database: SqliteDb, accountId: string): boolean {
  const row = database
    .prepare(`SELECT qusd_vault_interest_at FROM accounts WHERE id = ?`)
    .get(accountId) as { qusd_vault_interest_at: number | null } | undefined;
  if (!row) return false;

  const { locked } = getLedgerBalances(database, accountId);
  const now = Date.now();
  let start = row.qusd_vault_interest_at != null ? Number(row.qusd_vault_interest_at) : null;

  if (locked <= 1e-12) {
    if (start == null) {
      database.prepare(`UPDATE accounts SET qusd_vault_interest_at = ? WHERE id = ?`).run(now, accountId);
    }
    return false;
  }

  if (start == null) {
    database.prepare(`UPDATE accounts SET qusd_vault_interest_at = ? WHERE id = ?`).run(now, accountId);
    return false;
  }

  const minutes = Math.floor((now - start) / MS_PER_MINUTE);
  if (minutes < 1) return false;

  const newLocked = compoundLockedForFullMinutes(locked, minutes);
  const delta = newLocked - locked;
  const newStart = start + minutes * MS_PER_MINUTE;

  insertLockedVaultInterest(database, accountId, delta, now);
  database
    .prepare(
      `UPDATE accounts SET
        qusd_vault_interest_at = ?,
        updated_at = ?,
        sync_version = sync_version + 1
      WHERE id = ?`,
    )
    .run(newStart, now, accountId);
  return true;
}
