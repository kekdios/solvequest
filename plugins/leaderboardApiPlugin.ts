/**
 * GET /api/leaderboard — public top accounts by QUSD (masked email). Optional JWT highlights `is_you`.
 */
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";
import jwt from "jsonwebtoken";
import Database from "better-sqlite3";
import { resolveSolvequestDbPath } from "../server/accountEnsure";
import { ensureAccountsSchema } from "../server/ensureAccountsSchema";
import { ensureVisitorsSchema } from "../server/ensureVisitorsSchema";
import { queryLeaderboard } from "../server/leaderboardQuery";

type SqliteDb = InstanceType<typeof Database>;

const USER_COOKIE = "auth_token";

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export function createLeaderboardApiMiddleware(env: Record<string, string>, root: string): Connect.NextHandleFunction {
  const jwtSecret = env.JWT_SECRET;
  const jwtOk = Boolean(jwtSecret && jwtSecret !== "change-this-secret-key");
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
      console.error("[leaderboard-api] open db:", e);
      return null;
    }
  };

  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const url = req.url?.split("?")[0] ?? "";
    if (url !== "/api/leaderboard" || req.method !== "GET") {
      next();
      return;
    }

    const database = getDb();
    if (!database) {
      sendJson(res, 503, { error: "db_unavailable", rows: [] });
      return;
    }

    let yourAccountId: string | null = null;
    if (jwtOk) {
      const token = parseCookies(req.headers.cookie)[USER_COOKIE];
      if (token) {
        try {
          const payload = jwt.verify(token, jwtSecret!) as { email?: string };
          if (payload.email && typeof payload.email === "string") {
            const row = database
              .prepare(`SELECT id FROM accounts WHERE email = ?`)
              .get(payload.email.toLowerCase()) as { id: string } | undefined;
            if (row?.id) yourAccountId = String(row.id);
          }
        } catch {
          /* not signed in or bad token — public list still ok */
        }
      }
    }

    const qs = new URL(req.url ?? "", "http://localhost").searchParams;
    const limit = Math.min(100, Math.max(1, Number.parseInt(qs.get("limit") ?? "50", 10) || 50));

    try {
      const rows = queryLeaderboard(database, { limit, yourAccountId });
      sendJson(res, 200, { rows });
    } catch (e) {
      console.error("[leaderboard-api] GET /api/leaderboard:", e);
      sendJson(res, 500, { error: "leaderboard_failed", rows: [] });
    }
  };
}
