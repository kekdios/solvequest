/**
 * Idempotent: `daily_prize_winners`, `daily_prize_award_log`, and column migrations.
 */
import type Database from "better-sqlite3";

type SqliteDb = InstanceType<typeof Database>;

function tableInfo(database: SqliteDb, table: string): { name: string }[] {
  return database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
}

export function ensureDailyPrizeWinnersSchema(database: SqliteDb): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS daily_prize_winners (
      account_id TEXT PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
      won_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_daily_prize_winners_won_at ON daily_prize_winners (won_at DESC);
  `);

  const cols = tableInfo(database, "daily_prize_winners");
  if (!cols.some((c) => c.name === "prize_amount")) {
    database.exec(`ALTER TABLE daily_prize_winners ADD COLUMN prize_amount REAL`);
  }
  if (!cols.some((c) => c.name === "winner_label")) {
    database.exec(`ALTER TABLE daily_prize_winners ADD COLUMN winner_label TEXT`);
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS daily_prize_award_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      award_day_est TEXT NOT NULL UNIQUE,
      awarded_at INTEGER NOT NULL,
      account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
      prize_amount REAL NOT NULL,
      winner_label TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_daily_prize_award_log_awarded ON daily_prize_award_log (awarded_at DESC);
  `);
}
