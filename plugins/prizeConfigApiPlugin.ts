/**
 * Public prize pool: `GET /api/prize/config` — `PRIZE_AMOUNT` from env.
 * `GET /api/prize/awards` — recent automatic daily prize winners (from SQLite).
 */
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";
import Database from "better-sqlite3";
import { resolveSolvequestDbPath } from "../server/accountEnsure";
import { ensureAccountsSchema } from "../server/ensureAccountsSchema";
import { ensureVisitorsSchema } from "../server/ensureVisitorsSchema";
import { queryRecentPrizeAwards } from "../server/prizeAwardHistory";

type SqliteDb = InstanceType<typeof Database>;

function parseEnvNumber(raw: string | undefined, fallback: number): number {
  const n = Number.parseFloat((raw ?? "").trim());
  return Number.isFinite(n) ? n : fallback;
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export function createPrizeConfigApiMiddleware(
  env: Record<string, string>,
  root: string,
): Connect.NextHandleFunction {
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
      console.error("[prize-api] open db:", e);
      return null;
    }
  };

  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const url = req.url?.split("?")[0] ?? "";
    if (req.method !== "GET") {
      next();
      return;
    }

    if (url === "/api/prize/config") {
      const prizeAmount = parseEnvNumber(env.PRIZE_AMOUNT, 0);
      sendJson(res, 200, { prize_amount: prizeAmount });
      return;
    }

    if (url === "/api/prize/awards") {
      const qs = new URL(req.url ?? "", "http://localhost").searchParams;
      const limit = Math.min(50, Math.max(1, Number.parseInt(qs.get("limit") ?? "12", 10) || 12));
      const database = getDb();
      if (!database) {
        sendJson(res, 200, { rows: [] });
        return;
      }
      try {
        const rows = queryRecentPrizeAwards(database, limit);
        sendJson(res, 200, { rows });
      } catch (e) {
        console.error("[prize-api] awards:", e);
        sendJson(res, 500, { error: "awards_failed", rows: [] });
      }
      return;
    }

    next();
  };
}
