#!/usr/bin/env node
/**
 * Records that an account received the daily QUSD prize (one win per account, lifetime).
 * Usage: npx tsx scripts/record-daily-prize-winner.ts <account_id>
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import { resolveSolvequestDbPath } from "../server/accountEnsure";
import { ensureAccountsSchema } from "../server/ensureAccountsSchema";
import { recordDailyPrizeWin } from "../server/prizeWinOnce";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

const accountId = process.argv[2]?.trim();
if (!accountId) {
  console.error("Usage: npx tsx scripts/record-daily-prize-winner.ts <account_id>");
  process.exit(1);
}

const dbPath = resolveSolvequestDbPath(root, process.env as Record<string, string>);
const db = new Database(dbPath);
try {
  db.pragma("foreign_keys = ON");
  ensureAccountsSchema(db);
  const r = recordDailyPrizeWin(db, accountId, Date.now());
  if (!r.ok) {
    if (r.reason === "already_won") {
      console.error("Account is already recorded as a daily prize winner.");
    } else {
      console.error("No account with that id.");
    }
    process.exit(1);
  }
  console.log("Recorded daily prize win for", accountId);
} finally {
  db.close();
}
