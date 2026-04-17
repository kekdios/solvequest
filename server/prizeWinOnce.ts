/**
 * Daily QUSD prize: at most one recorded win per account (enforced by PRIMARY KEY).
 */
import type Database from "better-sqlite3";

type SqliteDb = InstanceType<typeof Database>;

export function hasWonDailyPrize(database: SqliteDb, accountId: string): boolean {
  const row = database
    .prepare(`SELECT 1 AS ok FROM daily_prize_winners WHERE account_id = ? LIMIT 1`)
    .get(accountId) as { ok: number } | undefined;
  return row != null;
}

export type RecordDailyPrizeWinResult = { ok: true } | { ok: false; reason: "already_won" | "no_such_account" };

/** Inserts a win row. Fails if the account already won or does not exist. */
export function recordDailyPrizeWin(database: SqliteDb, accountId: string, wonAt: number): RecordDailyPrizeWinResult {
  const acc = database.prepare(`SELECT 1 AS ok FROM accounts WHERE id = ?`).get(accountId) as { ok: number } | undefined;
  if (!acc) return { ok: false, reason: "no_such_account" };
  const info = database
    .prepare(`INSERT OR IGNORE INTO daily_prize_winners (account_id, won_at) VALUES (?, ?)`)
    .run(accountId, wonAt);
  if (info.changes === 0) return { ok: false, reason: "already_won" };
  return { ok: true };
}
