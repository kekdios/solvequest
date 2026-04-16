/**
 * POST /api/visitors/log — record SPA view (IP, geo, path). No auth.
 * GET /api/admin/visitors — paginated list; JWT email must match ADMIN_EMAIL.
 */
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";
import jwt from "jsonwebtoken";
import Database from "better-sqlite3";
import { z } from "zod";
import { resolveSolvequestDbPath } from "../server/accountEnsure";
import { ensureAccountsSchema } from "../server/ensureAccountsSchema";
import { ensureVisitorsSchema } from "../server/ensureVisitorsSchema";
import { getClientIp, locationFromIp } from "../server/visitorGeo";

type SqliteDb = InstanceType<typeof Database>;

const USER_COOKIE = "auth_token";

const logBodyZ = z.object({
  path: z.string().max(512).transform((s) => s.trim()).pipe(z.string().min(1)),
});

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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function isAdminEmail(email: string, env: Record<string, string>): boolean {
  const a = env.ADMIN_EMAIL?.trim().toLowerCase();
  return Boolean(a && email.toLowerCase() === a);
}

const PAGE_SIZE = 15;
const DEDUPE_MS = 2500;

export function createVisitorsApiMiddleware(env: Record<string, string>, root: string): Connect.NextHandleFunction {
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
      console.error("[visitors-api] open db:", e);
      return null;
    }
  };

  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const url = req.url?.split("?")[0] ?? "";
    if (!url.startsWith("/api/visitors") && !url.startsWith("/api/admin/visitors")) {
      next();
      return;
    }

    if (req.method === "POST" && url === "/api/visitors/log") {
      void (async () => {
        try {
          const raw = await readBody(req);
          let parsed: z.infer<typeof logBodyZ>;
          try {
            parsed = logBodyZ.parse(JSON.parse(raw || "{}"));
          } catch {
            sendJson(res, 400, { error: "invalid_body" });
            return;
          }
          const database = getDb();
          if (!database) {
            sendJson(res, 503, { error: "db_unavailable" });
            return;
          }
          const ip = getClientIp(req as IncomingMessage & { ip?: string });
          const now = Date.now();
          const dup = database
            .prepare(
              `SELECT created_at FROM visitors WHERE ip = ? AND path = ? ORDER BY created_at DESC LIMIT 1`,
            )
            .get(ip, parsed.path) as { created_at: number } | undefined;
          if (dup && now - dup.created_at < DEDUPE_MS) {
            res.statusCode = 204;
            res.end();
            return;
          }
          const location = locationFromIp(ip);
          database
            .prepare(
              `INSERT INTO visitors (created_at, ip, location, path) VALUES (?, ?, ?, ?)`,
            )
            .run(now, ip, location, parsed.path);
          res.statusCode = 204;
          res.end();
        } catch (e) {
          console.error("[visitors-api] POST /api/visitors/log:", e);
          sendJson(res, 500, { error: "log_failed" });
        }
      })();
      return;
    }

    if (req.method === "GET" && url === "/api/admin/visitors") {
      if (!jwtOk) {
        sendJson(res, 503, { error: "auth_not_configured" });
        return;
      }
      const token = parseCookies(req.headers.cookie)[USER_COOKIE];
      if (!token) {
        sendJson(res, 401, { error: "Not authenticated" });
        return;
      }
      let payload: { email?: string };
      try {
        payload = jwt.verify(token, jwtSecret!) as { email?: string };
      } catch {
        sendJson(res, 401, { error: "Invalid token" });
        return;
      }
      if (!payload.email || typeof payload.email !== "string") {
        sendJson(res, 401, { error: "Invalid token" });
        return;
      }
      if (!isAdminEmail(payload.email, env)) {
        sendJson(res, 403, { error: "forbidden" });
        return;
      }
      const database = getDb();
      if (!database) {
        sendJson(res, 503, { error: "db_unavailable" });
        return;
      }
      const qs = new URL(req.url ?? "", "http://localhost").searchParams;
      const page = Math.max(1, Number.parseInt(qs.get("page") ?? "1", 10) || 1);
      const offset = (page - 1) * PAGE_SIZE;
      try {
        const countRow = database.prepare(`SELECT COUNT(*) AS c FROM visitors`).get() as { c: number };
        const total = Number(countRow.c) || 0;
        const rows = database
          .prepare(
            `SELECT id, created_at, ip, location, path FROM visitors ORDER BY created_at DESC LIMIT ? OFFSET ?`,
          )
          .all(PAGE_SIZE, offset) as {
          id: number;
          created_at: number;
          ip: string;
          location: string;
          path: string;
        }[];
        sendJson(res, 200, {
          page,
          page_size: PAGE_SIZE,
          total,
          rows,
        });
      } catch (e) {
        console.error("[visitors-api] GET /api/admin/visitors:", e);
        sendJson(res, 500, { error: "list_failed" });
      }
      return;
    }

    next();
  };
}
