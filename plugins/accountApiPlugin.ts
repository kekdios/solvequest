/**
 * GET /api/account/me — loads SQLite `accounts` row for JWT email (dev/preview).
 * Env: JWT_SECRET (same as user auth), optional SOLVEQUEST_DB_PATH (default data/solvequest.db).
 * Creates a row on first login if none exists for that email.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";
import type { Plugin } from "vite";
import { loadEnv } from "vite";
import jwt from "jsonwebtoken";
import Database from "better-sqlite3";

type SqliteDb = InstanceType<typeof Database>;

const USER_COOKIE = "auth_token";

const DEFAULT_TIER_ID = 3;
const DEFAULT_COVERAGE_LIMIT_QUSD = 50_000;
const DEFAULT_QUSD_UNLOCKED = 10_000;

function resolveAccountDbPath(root: string, env: Record<string, string>): string {
  return env.SOLVEQUEST_DB_PATH?.trim() || path.join(root, "data", "solvequest.db");
}

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

type AccountRow = Record<string, unknown>;

export function createAccountApiMiddleware(env: Record<string, string>, root: string): Connect.NextHandleFunction {
  const jwtSecret = env.JWT_SECRET;
  const jwtOk = Boolean(jwtSecret && jwtSecret !== "change-this-secret-key");
  const dbPath = resolveAccountDbPath(root, env);

  let db: SqliteDb | null = null;

  const getDb = (): SqliteDb | null => {
    if (db) return db;
    if (!fs.existsSync(dbPath)) return null;
    try {
      db = new Database(dbPath);
      db.pragma("foreign_keys = ON");
      return db;
    } catch (e) {
      console.error("[account-api] open db:", e);
      return null;
    }
  };

  const loadOrCreateRow = (email: string): AccountRow | null => {
    const database = getDb();
    if (!database) return null;

    const sel = database.prepare(`SELECT * FROM accounts WHERE email = ?`);
    const existing = sel.get(email) as AccountRow | undefined;
    if (existing) {
      database.prepare(`UPDATE accounts SET updated_at = ? WHERE id = ?`).run(Date.now(), existing.id);
      return database.prepare(`SELECT * FROM accounts WHERE email = ?`).get(email) as AccountRow;
    }

    const now = Date.now();
    const id = randomUUID();
    try {
      database
        .prepare(
          `INSERT INTO accounts (
            id, created_at, updated_at, label, email,
            usdc_balance, coverage_limit_qusd, premium_accrued_usdc, covered_losses_qusd, coverage_used_qusd,
            tier_id, qusd_unlocked, qusd_locked, accumulated_losses_qusd
          ) VALUES (?, ?, ?, NULL, ?, 0, ?, 0, 0, 0, ?, ?, 0, 0)`,
        )
        .run(
          id,
          now,
          now,
          email,
          DEFAULT_COVERAGE_LIMIT_QUSD,
          DEFAULT_TIER_ID,
          DEFAULT_QUSD_UNLOCKED,
        );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("no column named email")) {
        console.error(
          "[account-api] accounts.email missing — run: npm run db:migrate:email",
        );
        return null;
      }
      throw e;
    }

    return sel.get(email) as AccountRow | undefined ?? null;
  };

  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const url = req.url?.split("?")[0] ?? "";
    if (!url.startsWith("/api/account")) {
      next();
      return;
    }

    if (!jwtOk) {
      sendJson(res, 503, { error: "auth_not_configured" });
      return;
    }

    if (req.method === "GET" && url === "/api/account/me") {
      const token = parseCookies(req.headers.cookie)[USER_COOKIE];
      if (!token) {
        sendJson(res, 401, { error: "Not authenticated" });
        return;
      }
      try {
        const payload = jwt.verify(token, jwtSecret!) as { email?: string };
        if (!payload.email || typeof payload.email !== "string") {
          sendJson(res, 401, { error: "Invalid token" });
          return;
        }
        const email = payload.email.toLowerCase();
        const row = loadOrCreateRow(email);
        if (!row) {
          if (!fs.existsSync(dbPath)) {
            sendJson(res, 503, {
              error: "db_missing",
              message: `No database at ${dbPath} — run npm run db:init`,
            });
            return;
          }
          sendJson(res, 503, {
            error: "db_schema",
            message: "Could not read accounts (run npm run db:migrate:email if upgrading).",
          });
          return;
        }
        sendJson(res, 200, row);
      } catch {
        sendJson(res, 401, { error: "Invalid token" });
      }
      return;
    }

    sendJson(res, 404, { error: "not_found" });
  };
}

export function accountApiPlugin(): Plugin {
  const attach = (server: { middlewares: Connect.Server; config: { root: string; mode: string } }) => {
    const env = {
      ...process.env,
      ...loadEnv(server.config.mode, server.config.root, ""),
    } as Record<string, string>;
    server.middlewares.use(createAccountApiMiddleware(env, server.config.root));
  };

  return {
    name: "solvequest-account-api",
    configureServer(server) {
      attach(server);
    },
    configurePreviewServer(server) {
      attach(server);
    },
  };
}
