/**
 * Idempotent: `daily_prize_winners` for one lifetime daily-prize win per account.
 */
import type Database from "better-sqlite3";

type SqliteDb = InstanceType<typeof Database>;

export function ensureDailyPrizeWinnersSchema(database: SqliteDb): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS daily_prize_winners (
      account_id TEXT PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
      won_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_daily_prize_winners_won_at ON daily_prize_winners (won_at DESC);
  `);
}
