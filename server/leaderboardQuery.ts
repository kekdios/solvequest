/**
 * Top accounts by total QUSD (ledger unlocked + locked sums).
 */
import type Database from "better-sqlite3";

type SqliteDb = InstanceType<typeof Database>;

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
       SELECT a.id AS account_id, a.email AS email, bal.qusd AS qusd
       FROM bal
       INNER JOIN accounts a ON a.id = bal.account_id
       WHERE a.email IS NOT NULL AND TRIM(a.email) != ''
         AND bal.qusd > 1e-9
       ORDER BY bal.qusd DESC, a.id ASC
       LIMIT ?`,
    )
    .all(limit) as { account_id: string; email: string; qusd: number }[];

  const your = opts.yourAccountId;
  return rows.map((r, i) => ({
    rank: i + 1,
    account_id: r.account_id,
    label: maskEmail(r.email),
    qusd: Number(r.qusd) || 0,
    is_you: your != null && r.account_id === your,
  }));
}
