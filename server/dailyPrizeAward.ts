/**
 * Daily QUSD prize: at 4:00 PM America/New_York, credit PRIZE_AMOUNT to the top prize-eligible leaderboard player.
 */
import type Database from "better-sqlite3";
import { insertDailyPrizeLedgerCredit } from "./qusdLedger";
import { leaderboardLabel } from "./leaderboardQuery";

type SqliteDb = InstanceType<typeof Database>;

function parseEnvNumber(raw: string | undefined, fallback: number): number {
  const n = Number.parseFloat((raw ?? "").trim());
  return Number.isFinite(n) ? n : fallback;
}

/** Calendar date YYYY-MM-DD in America/New_York (used for one award per local day). */
export function easternCalendarDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export type TopEligibleRow = {
  account_id: string;
  email: string;
  username: string | null;
  qusd: number;
};

/** Highest QUSD among accounts that have not yet won the daily prize (lifetime). */
export function findTopPrizeEligible(database: SqliteDb): TopEligibleRow | null {
  const row = database
    .prepare(
      `WITH bal AS (
         SELECT account_id,
           COALESCE(SUM(unlocked_delta), 0) + COALESCE(SUM(locked_delta), 0) AS qusd
         FROM qusd_ledger
         GROUP BY account_id
       )
       SELECT a.id AS account_id, a.email AS email, a.username AS username, bal.qusd AS qusd
       FROM bal
       INNER JOIN accounts a ON a.id = bal.account_id
       LEFT JOIN daily_prize_winners w ON w.account_id = bal.account_id
       WHERE a.email IS NOT NULL AND TRIM(a.email) != ''
         AND bal.qusd > 1e-9
         AND w.account_id IS NULL
       ORDER BY bal.qusd DESC, a.id ASC
       LIMIT 1`,
    )
    .get() as TopEligibleRow | undefined;
  return row ?? null;
}

export type DailyPrizeAwardResult =
  | { ok: true; skipped: false; winner: { account_id: string; label: string; prize_amount: number; awarded_at: number } }
  | { ok: true; skipped: true; reason: "disabled" | "prize_amount_zero" | "already_awarded_today" | "no_eligible" }
  | { ok: false; error: string };

/**
 * Runs the daily award in a single transaction. Safe to call repeatedly; at most one successful award per Eastern calendar day.
 */
export function runDailyPrizeAward(database: SqliteDb, env: NodeJS.ProcessEnv): DailyPrizeAwardResult {
  const disabled =
    env.SOLVEQUEST_DISABLE_DAILY_PRIZE_AWARD === "1" || env.SOLVEQUEST_DISABLE_DAILY_PRIZE_AWARD === "true";
  if (disabled) {
    return { ok: true, skipped: true, reason: "disabled" };
  }

  const prizeAmount = parseEnvNumber(env.PRIZE_AMOUNT, 0);
  if (prizeAmount <= 0) {
    return { ok: true, skipped: true, reason: "prize_amount_zero" };
  }

  const awardDayEst = easternCalendarDate();
  const now = Date.now();

  const dup = database
    .prepare(`SELECT 1 AS ok FROM daily_prize_award_log WHERE award_day_est = ? LIMIT 1`)
    .get(awardDayEst) as { ok: number } | undefined;
  if (dup) {
    return { ok: true, skipped: true, reason: "already_awarded_today" };
  }

  const winner = findTopPrizeEligible(database);
  if (!winner) {
    return { ok: true, skipped: true, reason: "no_eligible" };
  }

  const label = leaderboardLabel(winner.username, winner.email);

  try {
    database.transaction(() => {
      const logIns = database
        .prepare(
          `INSERT INTO daily_prize_award_log (award_day_est, awarded_at, account_id, prize_amount, winner_label)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(awardDayEst, now, winner.account_id, prizeAmount, label);

      if (logIns.changes === 0) {
        throw new Error("award_log_insert_failed");
      }

      const winIns = database
        .prepare(
          `INSERT INTO daily_prize_winners (account_id, won_at, prize_amount, winner_label)
           VALUES (?, ?, ?, ?)`,
        )
        .run(winner.account_id, now, prizeAmount, label);

      if (winIns.changes === 0) {
        throw new Error("winner_already_recorded");
      }

      insertDailyPrizeLedgerCredit(database, winner.account_id, prizeAmount, now);

      database
        .prepare(`UPDATE accounts SET sync_version = sync_version + 1, updated_at = ? WHERE id = ?`)
        .run(now, winner.account_id);
    })();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE") || msg.includes("constraint")) {
      return { ok: true, skipped: true, reason: "already_awarded_today" };
    }
    return { ok: false, error: msg };
  }

  console.log(
    `[daily-prize] awarded ${prizeAmount} QUSD to ${label} (${winner.account_id.slice(0, 8)}…) · day ${awardDayEst}`,
  );

  return {
    ok: true,
    skipped: false,
    winner: {
      account_id: winner.account_id,
      label,
      prize_amount: prizeAmount,
      awarded_at: now,
    },
  };
}
