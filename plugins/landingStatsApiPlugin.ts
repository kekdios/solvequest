/**
 * GET /api/landing-stats — lightweight public counts for marketing (24h closes, registered accounts).
 */
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";
import Database from "better-sqlite3";
import { resolveSolvequestDbPath } from "../server/accountEnsure";
import { ensureAccountsSchema } from "../server/ensureAccountsSchema";
import { ensureVisitorsSchema } from "../server/ensureVisitorsSchema";

type SqliteDb = InstanceType<typeof Database>;

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=60");
  res.end(JSON.stringify(body));
}

export function createLandingStatsApiMiddleware(env: Record<string, string>, root: string): Connect.NextHandleFunction {
  const dbPath = resolveSolvequestDbPath(root, env);
  let db: SqliteDb | null = null;

  const getDb = (): SqliteDb | null => {
    if (db) return db;
    if (!fs.existsSync(dbPath)) return null;
    try {
      db = new Database(dbPath);
      db.pragma("foreign_keys = ON");
      db.pragma("journal_mode = WAL");
      db.pragma("busy_timeout = 8000");
      ensureAccountsSchema(db);
      ensureVisitorsSchema(db);
      return db;
    } catch (e) {
      console.error("[landing-stats] open db:", e);
      return null;
    }
  };

  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const url = req.url?.split("?")[0] ?? "";
    if (url !== "/api/landing-stats" || req.method !== "GET") {
      next();
      return;
    }

    const database = getDb();
    if (!database) {
      sendJson(res, 200, { closes_24h: null, accounts_with_email: null });
      return;
    }

    const since = Date.now() - 24 * 60 * 60 * 1000;
    try {
      const closeRow = database
        .prepare(
          `SELECT COUNT(*) AS c FROM perp_transactions WHERE txn_type = 'close' AND closed_at IS NOT NULL AND closed_at >= ?`,
        )
        .get(since) as { c: number };
      const acctRow = database
        .prepare(`SELECT COUNT(*) AS c FROM accounts WHERE email IS NOT NULL AND TRIM(email) != ''`)
        .get() as { c: number };
      sendJson(res, 200, {
        closes_24h: Number(closeRow.c) || 0,
        accounts_with_email: Number(acctRow.c) || 0,
      });
    } catch (e) {
      console.error("[landing-stats] query:", e);
      sendJson(res, 200, { closes_24h: null, accounts_with_email: null });
    }
  };
}
