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
import { Keypair, PublicKey } from "@solana/web3.js";
import { deriveCustodialKeypairFromIndex } from "../server/custodialHdDerive";
import { getUsdcAta, MAINNET_USDC_MINT } from "../server/solanaUsdcScan";
import { z } from "zod";
import { PERP_SYMBOLS } from "../src/engine/perps";
import { applyLockedQusdInterest } from "./vaultInterest";
import {
  getLedgerBalances,
  insertPerpCloseSettlement,
  insertPerpMarginLock,
  insertSignupGrant,
  insertVaultMove,
} from "../server/qusdLedger";

type SqliteDb = InstanceType<typeof Database>;

const USER_COOKIE = "auth_token";

const DEFAULT_TIER_ID = 3;
const DEFAULT_COVERAGE_LIMIT_QUSD = 50_000;

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

const accountStatePutZ = z.object({
  sync_version: z.number().int().min(0),
  usdc_balance: z.number().finite(),
  coverage_limit_qusd: z.number().finite(),
  premium_accrued_usdc: z.number().finite(),
  covered_losses_qusd: z.number().finite(),
  coverage_used_qusd: z.number().finite(),
  /** Display unlocked / locked QUSD (not pre-margin); server ledger is source of truth after sync. */
  qusd_unlocked: z.number().finite(),
  qusd_locked: z.number().finite(),
  accumulated_losses_qusd: z.number().finite(),
  bonus_repaid_usdc: z.number().finite(),
  vault_activity_at: z.number().finite().nullable(),
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

function attachLedgerBalances(database: SqliteDb, row: AccountRow): AccountRow {
  const id = String(row.id);
  const { unlocked, locked } = getLedgerBalances(database, id);
  return { ...row, qusd_unlocked: unlocked, qusd_locked: locked };
}

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
      /** WAL + busy wait — deposit worker / concurrent reads were contending on the same file without this. */
      db.pragma("journal_mode = WAL");
      db.pragma("busy_timeout = 8000");
      return db;
    } catch (e) {
      console.error("[account-api] open db:", e);
      return null;
    }
  };

  /**
   * @param skipInterest — MUST be true for `PUT /api/account/state`. Otherwise vault interest bumps
   * `sync_version` before the optimistic-lock UPDATE and causes spurious 409s / failed writes.
   */
  const loadOrCreateRow = (email: string, options?: { skipInterest?: boolean }): AccountRow | null => {
    const database = getDb();
    if (!database) return null;

    const sel = database.prepare(`SELECT * FROM accounts WHERE email = ?`);
    const existing = sel.get(email) as AccountRow | undefined;
    if (existing) {
      if (!options?.skipInterest) {
        try {
          applyLockedQusdInterest(database, String(existing.id));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("no such column")) {
            console.error("[account-api] schema mismatch — run: npm run db:init on a fresh database");
            return null;
          }
          throw e;
        }
      }
      database.prepare(`UPDATE accounts SET updated_at = ? WHERE id = ?`).run(Date.now(), existing.id);
      const row = database.prepare(`SELECT * FROM accounts WHERE email = ?`).get(email) as AccountRow;
      return attachLedgerBalances(database, row);
    }

    const now = Date.now();
    const id = randomUUID();
    try {
      database
        .prepare(
          `INSERT INTO accounts (
            id, created_at, updated_at, email,
            usdc_balance, coverage_limit_qusd, premium_accrued_usdc, covered_losses_qusd, coverage_used_qusd,
            tier_id, accumulated_losses_qusd, bonus_repaid_usdc, vault_activity_at, qusd_vault_interest_at, sync_version
          ) VALUES (?, ?, ?, ?, 0, ?, 0, 0, 0, ?, 0, 0, NULL, NULL, 0)`,
        )
        .run(id, now, now, email, DEFAULT_COVERAGE_LIMIT_QUSD, DEFAULT_TIER_ID);
      insertSignupGrant(database, id, now);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("no column named email") || msg.includes("no such table: qusd_ledger")) {
        console.error("[account-api] run: npm run db:init (fresh schema with qusd_ledger)");
        return null;
      }
      throw e;
    }

    const created = sel.get(email) as AccountRow | undefined;
    return created ? attachLedgerBalances(database, created) : null;
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
        const custodialRow = row as {
          custodial_seckey_enc?: string | null;
          custodial_derivation_index?: number | null;
        };
        /** `!= null` is false for `undefined`, so use explicit checks. HD index 0 must count as custodial. */
        const di = custodialRow.custodial_derivation_index;
        const diNum = di === null || di === undefined ? NaN : Number(di);
        const hasHdIndex = Number.isFinite(diNum) && diNum >= 0;
        mePayload.custodial_deposit = Boolean(custodialRow.custodial_seckey_enc || hasHdIndex);
        sendJson(res, 200, mePayload);
      } catch {
        sendJson(res, 401, { error: "Invalid token" });
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

    if (req.method === "POST" && url === "/api/account/ensure-custodial-deposit") {
      void (async () => {
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
          const existing = database
            .prepare(
              `SELECT custodial_seckey_enc, custodial_derivation_index, sol_receive_address FROM accounts WHERE id = ?`,
            )
            .get(accountId) as
            | {
                custodial_seckey_enc: string | null;
                custodial_derivation_index: number | null;
                sol_receive_address: string | null;
              }
            | undefined;

          const envProc = env as unknown as NodeJS.ProcessEnv;

          if (existing?.custodial_seckey_enc && existing.sol_receive_address) {
            const owner = new PublicKey(existing.sol_receive_address.trim());
            const ata = getUsdcAta(owner);
            sendJson(res, 200, {
              ok: true,
              already_existed: true,
              deposit_address: existing.sol_receive_address.trim(),
              usdc_ata: ata.toBase58(),
              usdc_mint: MAINNET_USDC_MINT.toBase58(),
            });
            return;
          }

          if (existing != null && existing.custodial_derivation_index != null && existing.sol_receive_address) {
            const idx = Number(existing.custodial_derivation_index);
            let kp: Keypair;
            try {
              kp = deriveCustodialKeypairFromIndex(idx, envProc);
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              console.error("[account-api] ensure-custodial-deposit HD verify:", e);
              sendJson(res, 503, { error: "custodial_deposit_unavailable", message: msg });
              return;
            }
            if (kp.publicKey.toBase58() !== existing.sol_receive_address.trim()) {
              console.error("[account-api] HD pubkey mismatch for account", accountId.slice(0, 8));
              sendJson(res, 503, {
                error: "hd_address_mismatch",
                message: "Stored deposit address does not match HD derivation — check master key and DB.",
              });
              return;
            }
            const owner = kp.publicKey;
            const ata = getUsdcAta(owner);
            sendJson(res, 200, {
              ok: true,
              already_existed: true,
              deposit_address: existing.sol_receive_address.trim(),
              usdc_ata: ata.toBase58(),
              usdc_mint: MAINNET_USDC_MINT.toBase58(),
            });
            return;
          }

          try {
            const runHd = database.transaction(() => {
              const maxRow = database
                .prepare(`SELECT COALESCE(MAX(custodial_derivation_index), -1) AS m FROM accounts`)
                .get() as { m: number };
              const nextIndex = maxRow.m + 1;
              const kp = deriveCustodialKeypairFromIndex(nextIndex, envProc);
              const addr = kp.publicKey.toBase58();
              const now = Date.now();
              database
                .prepare(
                  `UPDATE accounts SET custodial_derivation_index = ?, sol_receive_address = ?, custodial_seckey_enc = NULL, updated_at = ? WHERE id = ?`,
                )
                .run(nextIndex, addr, now, accountId);
              return { kp, addr };
            });
            const { kp } = runHd();
            const ata = getUsdcAta(kp.publicKey);
            sendJson(res, 200, {
              ok: true,
              already_existed: false,
              deposit_address: kp.publicKey.toBase58(),
              usdc_ata: ata.toBase58(),
              usdc_mint: MAINNET_USDC_MINT.toBase58(),
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (
              msg.includes("no such column: custodial_seckey_enc") ||
              msg.includes("no such column: custodial_derivation_index")
            ) {
              sendJson(res, 503, {
                error: "db_schema",
                message:
                  "Schema missing custodial HD columns — run npm run db:init or scripts/migrate-custodial-hd.mjs.",
              });
              return;
            }
            console.error("[account-api] ensure-custodial-deposit:", e);
            sendJson(res, 503, {
              error: "custodial_deposit_unavailable",
              message: msg,
            });
          }
        } catch {
          sendJson(res, 401, { error: "Invalid token" });
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
        try {
          const payload = jwt.verify(token, jwtSecret!) as { email?: string };
          if (!payload.email || typeof payload.email !== "string") {
            sendJson(res, 401, { error: "Invalid token" });
            return;
          }
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
          const row = loadOrCreateRow(email, { skipInterest: true });
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

              /**
               * Vault lock/unlock only: must conserve total QUSD (du + dl ≈ 0). Never "mint" to match a buggy client
               * `qusd_unlocked` — that was inflating the ledger vs signup + trades + deposits.
               */
              const { unlocked: Lu, locked: Ll } = getLedgerBalances(database, accountId);
              const du = body.qusd_unlocked - Lu;
              const dl = body.qusd_locked - Ll;
              if (Math.abs(du) > 1e-6 || Math.abs(dl) > 1e-6) {
                if (Math.abs(du + dl) < 1e-5) {
                  insertVaultMove(database, accountId, du, dl, now);
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
                    vault_activity_at = ?,
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
                  body.vault_activity_at,
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
        } catch {
          sendJson(res, 401, { error: "Invalid token" });
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
