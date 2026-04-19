/**
 * Top accounts by total QUSD (ledger unlocked + locked sums).
 */
import type Database from "better-sqlite3";

type SqliteDb = InstanceType<typeof Database>;

/** Prefer cool username; fall back to masked email for legacy rows. */
export function leaderboardLabel(username: string | null | undefined, email: string): string {
  const u = username?.trim();
  if (u) return u;
  return maskEmail(email);
}

export function maskEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.indexOf("@");
  if (at <= 0) return "—";
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (!domain) return "—";
  const showLen = Math.min(2, Math.max(1, local.length));
  const show = local.slice(0, showLen);
  return `${show}***@${domain}`;
}

export type LeaderboardRow = {
  rank: number;
  account_id: string;
  label: string;
  qusd: number;
  is_you: boolean;
  /**
   * True if this account has not yet won the automatic daily prize (lifetime). This is **not** “only rank #1”:
   * several rows may show `prize_eligible: true` at once. The **daily winner** is always the single highest-QUSD
   * account among those eligible (`prize_rank === 1`).
   */
  prize_eligible: boolean;
  /** Among prize-eligible accounts only, by QUSD (same sort as overall `rank`). `null` if already won the daily prize. */
  prize_rank: number | null;
};

export function queryLeaderboard(database: SqliteDb, opts: { limit: number; yourAccountId: string | null }): LeaderboardRow[] {
  const limit = Math.min(100, Math.max(1, opts.limit));
  const rows = database
    .prepare(
      `WITH bal AS (
         SELECT account_id,
           COALESCE(SUM(unlocked_delta), 0) + COALESCE(SUM(locked_delta), 0) AS qusd
         FROM qusd_ledger
         GROUP BY account_id
       )
       SELECT a.id AS account_id, a.email AS email, a.username AS username, bal.qusd AS qusd,
              (w.account_id IS NOT NULL) AS has_won_daily_prize
       FROM bal
       INNER JOIN accounts a ON a.id = bal.account_id
       LEFT JOIN daily_prize_winners w ON w.account_id = bal.account_id
       WHERE a.email IS NOT NULL AND TRIM(a.email) != ''
         AND bal.qusd > 1e-9
       ORDER BY bal.qusd DESC, a.id ASC
       LIMIT ?`,
    )
    .all(limit) as {
      account_id: string;
      email: string;
      username: string | null;
      qusd: number;
      has_won_daily_prize: number;
    }[];

  const your = opts.yourAccountId;
  let prizeCounter = 0;
  return rows.map((r, i) => {
    const prize_eligible = !r.has_won_daily_prize;
    if (prize_eligible) prizeCounter += 1;
    return {
      rank: i + 1,
      account_id: r.account_id,
      label: leaderboardLabel(r.username, r.email),
      qusd: Number(r.qusd) || 0,
      is_you: your != null && r.account_id === your,
      prize_eligible,
      prize_rank: prize_eligible ? prizeCounter : null,
    };
  });
}
