/**
 * Recent automatic daily prize awards (public display).
 */
import type Database from "better-sqlite3";

type SqliteDb = InstanceType<typeof Database>;

export type PrizeAwardHistoryRow = {
  award_day_est: string;
  awarded_at: number;
  prize_amount: number;
  winner_label: string;
};

export function queryRecentPrizeAwards(database: SqliteDb, limit: number): PrizeAwardHistoryRow[] {
  const lim = Math.min(50, Math.max(1, limit));
  return database
    .prepare(
      `SELECT award_day_est, awarded_at, prize_amount, winner_label
       FROM daily_prize_award_log
       ORDER BY awarded_at DESC
       LIMIT ?`,
    )
    .all(lim) as PrizeAwardHistoryRow[];
}
