/**
 * GET /api/account/me — loads SQLite `accounts` row for JWT email (dev/preview).
 * Env: JWT_SECRET (same as user auth), optional SOLVEQUEST_DB_PATH (default data/solvequest.db).
 * Creates a row on first login if none exists for that email.
 */
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";
import type { Plugin } from "vite";
import { loadEnv } from "vite";
import jwt from "jsonwebtoken";
import Database from "better-sqlite3";
import { Connection, PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { PERP_SYMBOLS } from "../src/engine/perps";
import { ensureAccountRowForEmail, resolveSolvequestDbPath } from "../server/accountEnsure";
import { ensureAccountsSchema } from "../server/ensureAccountsSchema";
import {
  getLedgerBalances,
  insertAddressVerificationBonus,
  insertPerpCloseSettlement,
  insertPerpMarginLock,
} from "../server/qusdLedger";

type SqliteDb = InstanceType<typeof Database>;

const USER_COOKIE = "auth_token";

const perpSymbolZ = z.enum(PERP_SYMBOLS as unknown as [string, ...string[]]);

const perpPositionPutZ = z.object({
  id: z.string().min(1),
  symbol: perpSymbolZ,
  side: z.enum(["long", "short"]),
  entryPrice: z.number(),
  notionalUsdc: z.number(),
  leverage: z.number().finite(),
  marginUsdc: z.number(),
  openedAt: z.number(),
});

/** Client-queued close events → append-only `perp_transactions` (idempotent per position_id). */
const perpCloseEventPutZ = z.object({
  positionId: z.string().min(1),
  symbol: perpSymbolZ,
  side: z.enum(["long", "short"]),
  entryPrice: z.number().finite(),
  exitPrice: z.number().finite(),
  notionalUsdc: z.number().finite(),
  leverage: z.number().finite(),
  marginUsdc: z.number().finite(),
  openedAt: z.number(),
  realizedPnlQusd: z.number().finite(),
  closedAt: z.number(),
});

const verifySolanaAddressBodyZ = z.object({
  address: z
    .string()
    .max(100)
    .transform((s) => s.trim())
    .pipe(z.string().min(1)),
});

/** On-chain check: account must hold at least this much SOL (lamports). */
const MIN_SOL_LAMPORTS_FOR_VERIFY = 100_000;

function accountRpcUrl(env: Record<string, string>): string {
  return (
    env.SOLANA_RPC_URL?.trim() ||
    env.SOLANA_RPC_PROXY_TARGET?.trim() ||
    "https://api.mainnet-beta.solana.com"
  );
}

const accountStatePutZ = z.object({
  sync_version: z.number().int().min(0),
  usdc_balance: z.number().finite(),
  coverage_limit_qusd: z.number().finite(),
  premium_accrued_usdc: z.number().finite(),
  covered_losses_qusd: z.number().finite(),
  coverage_used_qusd: z.number().finite(),
  /** Spendable QUSD (ledger unlocked + locked merged; vault locking removed). */
  qusd_unlocked: z.number().finite(),
  accumulated_losses_qusd: z.number().finite(),
  bonus_repaid_usdc: z.number().finite(),
  open_perp_positions: z.array(perpPositionPutZ),
  perp_close_events: z.array(perpCloseEventPutZ).optional().default([]),
});

type DbOpenPos = {
  position_id: string;
  account_id: string;
  symbol: string;
  side: string;
  entry_price: number;
  notional_usdc: number;
  leverage: number;
  margin_usdc: number;
  opened_at: number;
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** True if any on-chain USDC deposit was credited for this account (`deposit_credits`). */
function accountHasSolanaDeposit(database: SqliteDb, accountId: string): boolean {
  try {
    const row = database
      .prepare(
        `SELECT 1 AS ok FROM deposit_credits WHERE account_id = ? AND chain = 'solana' AND kind = 'usdc' LIMIT 1`,
      )
      .get(accountId) as { ok: number } | undefined;
    return row != null;
  } catch {
    return false;
  }
}

function loadOpenPositions(database: SqliteDb, accountId: string): z.infer<typeof perpPositionPutZ>[] {
  const rows = database
    .prepare(
      `SELECT position_id, symbol, side, entry_price, notional_usdc, leverage, margin_usdc, opened_at
       FROM perp_open_positions WHERE account_id = ?`,
    )
    .all(accountId) as DbOpenPos[];
  return rows.map((r) => ({
    id: r.position_id,
    symbol: r.symbol,
    side: r.side as "long" | "short",
    entryPrice: r.entry_price,
    notionalUsdc: r.notional_usdc,
    leverage: r.leverage,
    marginUsdc: r.margin_usdc,
    openedAt: r.opened_at,
  }));
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

function attachLedgerBalances(database: SqliteDb, row: AccountRow): AccountRow {
  const id = String(row.id);
  const { unlocked, locked } = getLedgerBalances(database, id);
  const spendable = unlocked + locked;
  return { ...row, qusd_unlocked: spendable, qusd_locked: 0 };
}

export function createAccountApiMiddleware(env: Record<string, string>, root: string): Connect.NextHandleFunction {
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
      /** WAL + busy wait — deposit worker / concurrent reads were contending on the same file without this. */
      db.pragma("journal_mode = WAL");
      db.pragma("busy_timeout = 8000");
      ensureAccountsSchema(db);
      return db;
    } catch (e) {
      console.error("[account-api] open db:", e);
      return null;
    }
  };

  const loadOrCreateRow = (email: string): AccountRow | null => {
    const database = getDb();
    if (!database) return null;

    try {
      ensureAccountRowForEmail(database, email);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("no column named email") || msg.includes("no such table: qusd_ledger")) {
        console.error("[account-api] run: npm run db:init (fresh schema with qusd_ledger)");
        return null;
      }
      throw e;
    }

    const row = database.prepare(`SELECT * FROM accounts WHERE email = ?`).get(email.toLowerCase()) as
      | AccountRow
      | undefined;
    return row ? attachLedgerBalances(database, row) : null;
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
      try {
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
            message: "Could not read accounts — run npm run db:init on a fresh database if upgrading from an old schema.",
          });
          return;
        }
        const database = getDb();
        const accountId = String(row.id);
        let openPerp: ReturnType<typeof loadOpenPositions> = [];
        try {
          openPerp =
            database && accountId ? loadOpenPositions(database, accountId) : [];
        } catch (e) {
          console.error("[account-api] load open positions:", e);
          sendJson(res, 503, {
            error: "db_schema",
            message:
              "SQLite schema mismatch (e.g. missing perp_open_positions). On the host: npm run db:init on a fresh DB.",
          });
          return;
        }
        const mePayload = { ...row, open_perp_positions: openPerp } as Record<string, unknown>;
        mePayload.sync_version = Number((row as AccountRow).sync_version ?? 0);
        mePayload.account_active =
          database != null ? accountHasSolanaDeposit(database, accountId) : false;
        sendJson(res, 200, mePayload);
      } catch (e) {
        console.error("[account-api] GET /api/account/me:", e);
        const msg = e instanceof Error ? e.message : String(e);
        sendJson(res, 503, {
          error: "account_load_failed",
          message: msg,
        });
      }
      return;
    }

    if (req.method === "GET" && url === "/api/account/perp-closes") {
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
      try {
        const email = payload.email.toLowerCase();
        const row = loadOrCreateRow(email);
        if (!row?.id) {
          sendJson(res, 503, { error: "no_account" });
          return;
        }
        const database = getDb();
        if (!database) {
          sendJson(res, 503, { error: "db_missing" });
          return;
        }
        const accountId = String(row.id);
        const qs = new URL(req.url ?? "", "http://localhost").searchParams;
        const page = Math.max(1, Number.parseInt(qs.get("page") ?? "1", 10) || 1);
        const pageSize = Math.min(100, Math.max(1, Number.parseInt(qs.get("page_size") ?? "20", 10) || 20));
        const offset = (page - 1) * pageSize;
        const countRow = database
          .prepare(
            `SELECT COUNT(*) AS c FROM perp_transactions WHERE account_id = ? AND txn_type = 'close'`,
          )
          .get(accountId) as { c: number };
        const total = Number(countRow.c) || 0;
        const rows = database
          .prepare(
            `SELECT id, position_id, symbol, side, entry_price, exit_price, notional_usdc, leverage, margin_usdc,
                    opened_at, realized_pnl_qusd, closed_at, inserted_at
             FROM perp_transactions
             WHERE account_id = ? AND txn_type = 'close'
             ORDER BY closed_at DESC
             LIMIT ? OFFSET ?`,
          )
          .all(accountId, pageSize, offset) as Record<string, unknown>[];
        sendJson(res, 200, {
          closes: rows,
          total,
          page,
          page_size: pageSize,
        });
      } catch (e) {
        console.error("[account-api] GET /api/account/perp-closes:", e);
        sendJson(res, 500, {
          error: "perp_closes_query_failed",
          message: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }

    if (req.method === "POST" && url === "/api/account/verify-solana-address") {
      void (async () => {
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
        let body: z.infer<typeof verifySolanaAddressBodyZ>;
        try {
          body = verifySolanaAddressBodyZ.parse(JSON.parse((await readBody(req)) || "{}"));
        } catch (e) {
          sendJson(res, 400, {
            error: "invalid_body",
            message: e instanceof Error ? e.message : String(e),
          });
          return;
        }
        const email = payload.email.toLowerCase();
        let pk: PublicKey;
        try {
          pk = new PublicKey(body.address.trim());
        } catch {
          sendJson(res, 400, {
            error: "invalid_address",
            message: "That is not a valid Solana address.",
          });
          return;
        }
        const addressNormalized = pk.toBase58();
        try {
          const row = loadOrCreateRow(email);
          if (!row?.id) {
            sendJson(res, 503, { error: "no_account" });
            return;
          }
          const database = getDb();
          if (!database) {
            sendJson(res, 503, { error: "db_missing" });
            return;
          }
          const accountId = String(row.id);
          const cur = database
            .prepare(
              `SELECT sol_receive_verified_at FROM accounts WHERE id = ?`,
            )
            .get(accountId) as { sol_receive_verified_at: number | null } | undefined;
          if (cur?.sol_receive_verified_at != null) {
            sendJson(res, 400, {
              error: "already_verified",
              message: "Your Solana address is already verified and cannot be changed.",
            });
            return;
          }

          const taken = database
            .prepare(
              `SELECT id FROM accounts WHERE id != ? AND TRIM(sol_receive_address) = ?`,
            )
            .get(accountId, addressNormalized) as { id: string } | undefined;
          if (taken) {
            sendJson(res, 409, {
              error: "address_in_use",
              message: "This Solana address is already linked to another account.",
            });
            return;
          }

          const connection = new Connection(accountRpcUrl(env), "confirmed");
          let lamports: number;
          try {
            lamports = await connection.getBalance(pk, "confirmed");
          } catch (e) {
            console.error("[account-api] verify-solana-address RPC:", e);
            sendJson(res, 503, {
              error: "rpc_error",
              message: "Could not reach Solana RPC to verify this address.",
            });
            return;
          }
          if (lamports < MIN_SOL_LAMPORTS_FOR_VERIFY) {
            sendJson(res, 400, {
              error: "insufficient_sol",
              message: `This address must hold at least ${MIN_SOL_LAMPORTS_FOR_VERIFY} lamports of SOL on mainnet (≈0.0001 SOL).`,
              min_lamports: MIN_SOL_LAMPORTS_FOR_VERIFY,
              lamports,
            });
            return;
          }

          const now = Date.now();
          const run = database.transaction(() => {
            database
              .prepare(
                `UPDATE accounts SET
                  sol_receive_address = ?,
                  sol_receive_verified_at = ?,
                  custodial_derivation_index = NULL,
                  custodial_seckey_enc = NULL,
                  updated_at = ?,
                  sync_version = sync_version + 1
                WHERE id = ?`,
              )
              .run(addressNormalized, now, now, accountId);
            insertAddressVerificationBonus(database, accountId, now);
          });
          run();

          const fresh = database.prepare(`SELECT * FROM accounts WHERE id = ?`).get(accountId) as AccountRow;
          sendJson(res, 200, {
            ok: true,
            account: attachLedgerBalances(database, fresh),
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("UNIQUE") || msg.includes("constraint")) {
            sendJson(res, 409, {
              error: "address_in_use",
              message: "This Solana address is already linked to another account.",
            });
            return;
          }
          console.error("[account-api] verify-solana-address:", e);
          sendJson(res, 500, { error: "verify_failed", message: msg });
        }
      })();
      return;
    }

    if (req.method === "PUT" && url === "/api/account/state") {
      void (async () => {
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
        try {
          const email = payload.email.toLowerCase();
          let body: z.infer<typeof accountStatePutZ>;
          try {
            body = accountStatePutZ.parse(JSON.parse((await readBody(req)) || "{}"));
          } catch (e) {
            sendJson(res, 400, {
              error: "invalid_body",
              message: e instanceof Error ? e.message : String(e),
            });
            return;
          }
          const row = loadOrCreateRow(email);
          if (!row?.id) {
            sendJson(res, 503, { error: "no_account" });
            return;
          }
          const accountId = String(row.id);
          const database = getDb();
          if (!database) {
            sendJson(res, 503, { error: "db_missing" });
            return;
          }
          const now = Date.now();
          try {
            const run = database.transaction(() => {
              const prevOpens = database
                .prepare(`SELECT position_id FROM perp_open_positions WHERE account_id = ?`)
                .all(accountId) as { position_id: string }[];
              const prevOpenIds = new Set(prevOpens.map((r) => r.position_id));

              for (const e of body.perp_close_events ?? []) {
                const credit = e.marginUsdc + e.realizedPnlQusd;
                insertPerpCloseSettlement(database, accountId, e.positionId, credit, now);
              }

              database.prepare(`DELETE FROM perp_open_positions WHERE account_id = ?`).run(accountId);
              const ins = database.prepare(
                `INSERT INTO perp_open_positions (
                  position_id, account_id, symbol, side, entry_price, notional_usdc, leverage, margin_usdc, opened_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              );
              for (const p of body.open_perp_positions) {
                ins.run(
                  p.id,
                  accountId,
                  p.symbol,
                  p.side,
                  p.entryPrice,
                  p.notionalUsdc,
                  p.leverage,
                  p.marginUsdc,
                  p.openedAt,
                );
                if (!prevOpenIds.has(p.id)) {
                  insertPerpMarginLock(database, accountId, p.id, p.marginUsdc, now);
                }
              }

              const upd = database
                .prepare(
                  `UPDATE accounts SET
                    updated_at = ?,
                    usdc_balance = ?,
                    coverage_limit_qusd = ?,
                    premium_accrued_usdc = ?,
                    covered_losses_qusd = ?,
                    coverage_used_qusd = ?,
                    accumulated_losses_qusd = ?,
                    bonus_repaid_usdc = ?,
                    vault_activity_at = NULL,
                    sync_version = sync_version + 1
                  WHERE id = ? AND sync_version = ?`,
                )
                .run(
                  now,
                  body.usdc_balance,
                  body.coverage_limit_qusd,
                  body.premium_accrued_usdc,
                  body.covered_losses_qusd,
                  body.coverage_used_qusd,
                  body.accumulated_losses_qusd,
                  body.bonus_repaid_usdc,
                  accountId,
                  body.sync_version,
                );
              if (upd.changes !== 1) {
                throw Object.assign(new Error("sync_conflict"), { code: "SYNC_CONFLICT" as const });
              }
              const insClose = database.prepare(
                `INSERT OR IGNORE INTO perp_transactions (
                  account_id, position_id, txn_type, symbol, side,
                  entry_price, notional_usdc, leverage, margin_usdc, opened_at,
                  exit_price, realized_pnl_qusd, closed_at, inserted_at
                ) VALUES (?, ?, 'close', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              );
              for (const e of body.perp_close_events ?? []) {
                insClose.run(
                  accountId,
                  e.positionId,
                  e.symbol,
                  e.side,
                  e.entryPrice,
                  e.notionalUsdc,
                  e.leverage,
                  e.marginUsdc,
                  e.openedAt,
                  e.exitPrice,
                  e.realizedPnlQusd,
                  e.closedAt,
                  now,
                );
              }
            });
            run();
          } catch (e: unknown) {
            if (e && typeof e === "object" && (e as { code?: string }).code === "SYNC_CONFLICT") {
              const cur = database
                .prepare(`SELECT sync_version FROM accounts WHERE id = ?`)
                .get(accountId) as { sync_version: number } | undefined;
              sendJson(res, 409, {
                error: "sync_conflict",
                sync_version: Number(cur?.sync_version ?? 0),
              });
              return;
            }
            console.error("[account-api] PUT /api/account/state:", e);
            sendJson(res, 500, { error: "persist_failed" });
            return;
          }
          const nv = database
            .prepare(`SELECT sync_version FROM accounts WHERE id = ?`)
            .get(accountId) as { sync_version: number };
          sendJson(res, 200, { ok: true, sync_version: Number(nv.sync_version) });
        } catch (e: unknown) {
          console.error("[account-api] PUT /api/account/state (unexpected):", e);
          sendJson(res, 500, {
            error: "state_update_failed",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      })();
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
