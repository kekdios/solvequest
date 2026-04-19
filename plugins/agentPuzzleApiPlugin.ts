/**
 * Solve For Bonus — word-order puzzle + QUSD reward (SQLite, no Redis).
 * POST /api/puzzle/start — auth: new 4-word challenge.
 * POST /api/puzzle/submit — auth: validate order, credit ledger (idempotent, daily cap).
 */
import { randomInt, randomUUID } from "node:crypto";
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";
import jwt from "jsonwebtoken";
import Database from "better-sqlite3";
import { z } from "zod";
import { wordlist as ENGLISH_WORDS } from "@scure/bip39/wordlists/english.js";
import { resolveSolvequestDbPath } from "../server/accountEnsure";
import { ensureAccountsSchema } from "../server/ensureAccountsSchema";
import { ensureVisitorsSchema } from "../server/ensureVisitorsSchema";
import { ensurePuzzleSchema } from "../server/ensurePuzzleSchema";
import { easternCalendarDate } from "../server/dailyPrizeAward";
import { insertPuzzleReward, sumPuzzleRewardsForEasternDay } from "../server/qusdLedger";

type SqliteDb = InstanceType<typeof Database>;

const USER_COOKIE = "auth_token";

const WORD_COUNT = 4;
const SESSION_TTL_MS = 20 * 60 * 1000;
const BASE_QUSD = 100;
const DAILY_CAP_QUSD = 500;
const MIN_ELAPSED_MS = 8_000;
const MAX_ELAPSED_MS = 15 * 60 * 1000;
const MIN_DRAG_EVENTS = 3;
const MAX_STARTS_PER_HOUR = 12;

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("=").trim());
  }
  return out;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function pickDistinctWords(n: number): string[] {
  const picked = new Set<number>();
  const out: string[] = [];
  let guard = 0;
  while (out.length < n && guard < n * 1000) {
    guard++;
    const i = randomInt(0, ENGLISH_WORDS.length);
    if (picked.has(i)) continue;
    picked.add(i);
    out.push(ENGLISH_WORDS[i]!);
  }
  if (out.length < n) throw new Error("word_pick_failed");
  return out;
}

function timeBonusQusd(elapsedMs: number): number {
  const sec = Math.ceil(elapsedMs / 1000);
  if (sec >= 120) return 0;
  return Math.min(100, Math.max(0, 120 - sec));
}

function normalizeWord(w: string): string {
  return w.trim().toLowerCase();
}

function ordersMatch(submitted: string[], solution: string[]): boolean {
  if (submitted.length !== solution.length) return false;
  for (let i = 0; i < submitted.length; i++) {
    if (normalizeWord(submitted[i]!) !== normalizeWord(solution[i]!)) return false;
  }
  return true;
}

const submitBodyZ = z.object({
  puzzle_id: z.string().uuid(),
  ordered_words: z.array(z.string().min(1).max(32)).length(WORD_COUNT),
  elapsed_ms: z.number().finite(),
  drag_events: z.number().int().min(0).max(20_000),
});

export function createAgentPuzzleApiMiddleware(
  env: Record<string, string>,
  root: string,
): Connect.NextHandleFunction {
  const dbPath = resolveSolvequestDbPath(root, env);
  const jwtSecret = env.JWT_SECRET?.trim();
  const jwtOk = Boolean(jwtSecret);

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
      ensurePuzzleSchema(db);
      return db;
    } catch (e) {
      console.error("[puzzle-api] open db:", e);
      return null;
    }
  };

  return async (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const url = req.url?.split("?")[0] ?? "";
    if (!url.startsWith("/api/puzzle")) {
      next();
      return;
    }

    if (!jwtOk) {
      sendJson(res, 503, { error: "auth_not_configured" });
      return;
    }

    const database = getDb();
    if (!database) {
      sendJson(res, 503, { error: "db_missing", message: `No database at ${dbPath}` });
      return;
    }

    const token = parseCookies(req.headers.cookie)[USER_COOKIE];
    if (!token) {
      sendJson(res, 401, { error: "not_authenticated" });
      return;
    }
    let payload: { email?: string };
    try {
      payload = jwt.verify(token, jwtSecret!) as { email?: string };
    } catch {
      sendJson(res, 401, { error: "invalid_token" });
      return;
    }
    if (!payload.email || typeof payload.email !== "string") {
      sendJson(res, 401, { error: "invalid_token" });
      return;
    }

    const email = payload.email.toLowerCase();
    const acc = database.prepare(`SELECT id FROM accounts WHERE email = ?`).get(email) as { id: string } | undefined;
    if (!acc) {
      sendJson(res, 403, { error: "no_account" });
      return;
    }
    const accountId = acc.id;
    const now = Date.now();

    if (req.method === "POST" && url === "/api/puzzle/start") {
      const hourAgo = now - 60 * 60 * 1000;
      const recentStarts = database
        .prepare(`SELECT COUNT(*) AS c FROM puzzle_sessions WHERE account_id = ? AND created_at > ?`)
        .get(accountId, hourAgo) as { c: number };
      if (Number(recentStarts.c) >= MAX_STARTS_PER_HOUR) {
        sendJson(res, 429, { error: "rate_limit", message: "Too many puzzle starts; try again later." });
        return;
      }

      try {
        const solution = pickDistinctWords(WORD_COUNT);
        const display = shuffle([...solution]);
        const id = randomUUID();
        const expiresAt = now + SESSION_TTL_MS;
        database
          .prepare(
            `INSERT INTO puzzle_sessions (id, account_id, created_at, expires_at, words_json, solution_json, solved_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL)`,
          )
          .run(id, accountId, now, expiresAt, JSON.stringify(display), JSON.stringify(solution));
        sendJson(res, 200, {
          puzzle_id: id,
          words: display,
          word_count: WORD_COUNT,
          expires_at_ms: expiresAt,
        });
      } catch (e) {
        console.error("[puzzle-api] start:", e);
        sendJson(res, 500, { error: "start_failed" });
      }
      return;
    }

    if (req.method === "POST" && url === "/api/puzzle/submit") {
      let raw: unknown;
      try {
        raw = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: "invalid_json" });
        return;
      }
      const parsed = submitBodyZ.safeParse(raw);
      if (!parsed.success) {
        sendJson(res, 400, { error: "invalid_body", details: parsed.error.flatten() });
        return;
      }
      const { puzzle_id, ordered_words, elapsed_ms, drag_events } = parsed.data;

      if (elapsed_ms < MIN_ELAPSED_MS || elapsed_ms > MAX_ELAPSED_MS) {
        sendJson(res, 400, { error: "bad_timing", message: "Elapsed time out of allowed range." });
        return;
      }
      if (drag_events < MIN_DRAG_EVENTS) {
        sendJson(res, 400, { error: "low_engagement", message: "Not enough interaction events recorded." });
        return;
      }

      const row = database
        .prepare(
          `SELECT id, account_id, expires_at, solution_json, solved_at FROM puzzle_sessions WHERE id = ?`,
        )
        .get(puzzle_id) as
        | {
            id: string;
            account_id: string;
            expires_at: number;
            solution_json: string;
            solved_at: number | null;
          }
        | undefined;

      if (!row || row.account_id !== accountId) {
        sendJson(res, 404, { error: "puzzle_not_found" });
        return;
      }
      if (row.solved_at != null) {
        sendJson(res, 409, { error: "already_solved" });
        return;
      }
      if (now > row.expires_at) {
        sendJson(res, 410, { error: "expired" });
        return;
      }

      let solution: string[];
      try {
        solution = JSON.parse(row.solution_json) as string[];
      } catch {
        sendJson(res, 500, { error: "server_puzzle_corrupt" });
        return;
      }
      if (!ordersMatch(ordered_words, solution)) {
        sendJson(res, 400, { error: "wrong_order" });
        return;
      }

      const awardDay = easternCalendarDate(new Date(now));
      const earnedToday = sumPuzzleRewardsForEasternDay(database, accountId, awardDay);
      if (earnedToday >= DAILY_CAP_QUSD) {
        sendJson(res, 403, { error: "daily_cap", earned_today: earnedToday, cap: DAILY_CAP_QUSD });
        return;
      }

      const rawReward = BASE_QUSD + timeBonusQusd(elapsed_ms);
      const reward = Math.min(rawReward, Math.max(0, DAILY_CAP_QUSD - earnedToday));

      try {
        database.transaction(() => {
          const up = database
            .prepare(`UPDATE puzzle_sessions SET solved_at = ? WHERE id = ? AND solved_at IS NULL`)
            .run(now, puzzle_id);
          if (Number(up.changes) !== 1) {
            throw new Error("concurrent_solve");
          }
          const inserted = insertPuzzleReward(database, accountId, reward, awardDay, puzzle_id, now);
          if (!inserted) {
            throw new Error("ledger_idempotent_fail");
          }
        })();
        sendJson(res, 200, {
          ok: true,
          qusd_credited: reward,
          base_qusd: BASE_QUSD,
          time_bonus_qusd: timeBonusQusd(elapsed_ms),
          daily_earned_after: earnedToday + reward,
          daily_cap: DAILY_CAP_QUSD,
        });
      } catch (e) {
        console.error("[puzzle-api] submit:", e);
        sendJson(res, 409, { error: "submit_conflict" });
      }
      return;
    }

    if (req.method === "GET" && url === "/api/puzzle/status") {
      const awardDay = easternCalendarDate(new Date(now));
      const earnedToday = sumPuzzleRewardsForEasternDay(database, accountId, awardDay);
      sendJson(res, 200, {
        daily_cap: DAILY_CAP_QUSD,
        earned_today: earnedToday,
        remaining_today: Math.max(0, DAILY_CAP_QUSD - earnedToday),
      });
      return;
    }

    next();
  };
}
