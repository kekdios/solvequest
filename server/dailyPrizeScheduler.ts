/**
 * Schedules automatic daily QUSD prize at 4:00 PM Eastern Time (America/New_York).
 */
import fs from "node:fs";
import cron from "node-cron";
import { openDepositDatabase, resolveDbPath } from "./qusdBuyScanWorker";
import { runDailyPrizeAward } from "./dailyPrizeAward";

export function startDailyPrizeScheduler(root: string, env: NodeJS.ProcessEnv): void {
  const dbPath = resolveDbPath(root, env);

  cron.schedule(
    "0 16 * * *",
    () => {
      if (!fs.existsSync(dbPath)) {
        console.warn("[daily-prize] database missing — skip scheduled run");
        return;
      }
      let database: ReturnType<typeof openDepositDatabase> | undefined;
      try {
        database = openDepositDatabase(dbPath);
        const result = runDailyPrizeAward(database, env);
        if (result.ok && result.skipped) {
          console.log(`[daily-prize] skipped (${result.reason})`);
        } else if (!result.ok) {
          console.error("[daily-prize] award failed:", result.error);
        }
      } catch (e) {
        console.error("[daily-prize] scheduled run:", e);
      } finally {
        try {
          database?.close();
        } catch {
          /* ignore */
        }
      }
    },
    { timezone: "America/New_York" },
  );

  console.log(
    "[daily-prize] cron 4:00 PM America/New_York → top prize-eligible player receives PRIZE_AMOUNT (set SOLVEQUEST_DISABLE_DAILY_PRIZE_AWARD=1 to disable)",
  );
}
