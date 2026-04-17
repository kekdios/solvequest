#!/usr/bin/env npx tsx
/**
 * Manually run the daily QUSD prize award (same logic as the 4 PM Eastern cron).
 * Usage: npx tsx scripts/run-daily-prize-award.ts
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { openDepositDatabase, resolveDbPath } from "../server/qusdBuyScanWorker";
import { runDailyPrizeAward } from "../server/dailyPrizeAward";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

const dbPath = resolveDbPath(root, process.env);
const database = openDepositDatabase(dbPath);
try {
  const result = runDailyPrizeAward(database, process.env);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
} finally {
  database.close();
}
