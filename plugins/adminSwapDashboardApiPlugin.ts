/**
 * GET /api/admin/swap-dashboard — admin-only: swap env snapshot, treasury/receive balances, paginated swaps & refund errors.
 * POST /api/admin/run-deposit-scan — admin-only: one full USDC→QUSD deposit scan (same logic as background worker).
 */
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";
import jwt from "jsonwebtoken";
import Database from "better-sqlite3";
import { Connection, PublicKey } from "@solana/web3.js";
import { resolveSolvequestDbPath } from "../server/accountEnsure";
import { ensureAccountsSchema } from "../server/ensureAccountsSchema";
import { ensureVisitorsSchema } from "../server/ensureVisitorsSchema";
import { getUsdcAtaBalanceUi } from "../server/solanaUsdcScan";
import { recordDepositScanTickComplete } from "../server/depositScanHealth";
import { runQusdBuyScanOnce } from "../server/qusdBuyScanWorker";

type SqliteDb = InstanceType<typeof Database>;

const USER_COOKIE = "auth_token";
const PAGE_SIZE = 20;

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
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function isAdminEmail(email: string, env: Record<string, string>): boolean {
  const a = env.ADMIN_EMAIL?.trim().toLowerCase();
  return Boolean(a && email.toLowerCase() === a);
}

function rpcUrl(env: Record<string, string>): string {
  return (
    env.SOLANA_RPC_URL?.trim() ||
    env.SOLANA_RPC_PROXY_TARGET?.trim() ||
    "https://api.mainnet-beta.solana.com"
  );
}

type AddrBalance = {
  address: string | null;
  valid: boolean;
  usdc_ui: number | null;
  sol_lamports: number | null;
  error?: string;
};

async function fetchAddressBalances(
  env: Record<string, string>,
  raw: string | undefined,
): Promise<AddrBalance> {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return { address: null, valid: false, usdc_ui: null, sol_lamports: null };
  }
  let pk: PublicKey;
  try {
    pk = new PublicKey(trimmed);
  } catch {
    return {
      address: trimmed,
      valid: false,
      usdc_ui: null,
      sol_lamports: null,
      error: "invalid_pubkey",
    };
  }
  const addr = pk.toBase58();
  try {
    const connection = new Connection(rpcUrl(env), "confirmed");
    const [usdcUi, solLamports] = await Promise.all([
      getUsdcAtaBalanceUi(connection, pk),
      connection.getBalance(pk, "confirmed"),
    ]);
    return { address: addr, valid: true, usdc_ui: usdcUi, sol_lamports: solLamports };
  } catch (e) {
    return {
      address: addr,
      valid: true,
      usdc_ui: null,
      sol_lamports: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function createAdminSwapDashboardApiMiddleware(
  env: Record<string, string>,
  root: string,
): Connect.NextHandleFunction {
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
      console.error("[admin-swap-dashboard] open db:", e);
      return null;
    }
  };

  const requireAdmin = (
    req: IncomingMessage,
    res: ServerResponse,
  ): { email: string } | null => {
    if (!jwtOk) {
      sendJson(res, 503, { error: "auth_not_configured" });
      return null;
    }
    const token = parseCookies(req.headers.cookie)[USER_COOKIE];
    if (!token) {
      sendJson(res, 401, { error: "not_authenticated" });
      return null;
    }
    let email: string;
    try {
      const p = jwt.verify(token, jwtSecret!) as { email?: string };
      if (!p.email || typeof p.email !== "string") {
        sendJson(res, 401, { error: "invalid_token" });
        return null;
      }
      email = p.email.toLowerCase();
    } catch {
      sendJson(res, 401, { error: "invalid_token" });
      return null;
    }
    if (!isAdminEmail(email, env)) {
      sendJson(res, 403, { error: "forbidden" });
      return null;
    }
    return { email };
  };

  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const url = req.url?.split("?")[0] ?? "";

    if (url === "/api/admin/run-deposit-scan" && req.method === "POST") {
      void (async () => {
        if (!requireAdmin(req, res)) return;
        try {
          const result = await runQusdBuyScanOnce(root, process.env, { verbose: true });
          if (result.ok) {
            recordDepositScanTickComplete();
            sendJson(res, 200, {
              ok: true,
              accounts_scanned: result.accountsScanned,
              reports: result.reports ?? [],
            });
          } else {
            sendJson(res, 500, { ok: false, error: result.error });
          }
        } catch (e) {
          console.error("[admin] run-deposit-scan:", e);
          sendJson(res, 500, {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      })();
      return;
    }

    if (url !== "/api/admin/swap-dashboard") {
      next();
      return;
    }
    if (req.method !== "GET") {
      next();
      return;
    }

    void (async () => {
      if (!requireAdmin(req, res)) return;

      const database = getDb();
      if (!database) {
        sendJson(res, 503, { error: "db_unavailable" });
        return;
      }

      const qs = new URL(req.url ?? "", "http://localhost").searchParams;
      const swapsPage = Math.max(1, Number.parseInt(qs.get("swaps_page") ?? "1", 10) || 1);
      const errorsPage = Math.max(1, Number.parseInt(qs.get("errors_page") ?? "1", 10) || 1);
      const swapsOffset = (swapsPage - 1) * PAGE_SIZE;
      const errorsOffset = (errorsPage - 1) * PAGE_SIZE;

      const envSnapshot = {
        SOLANA_TREASURY_ADDRESS: (env.SOLANA_TREASURY_ADDRESS ?? "").trim(),
        SWAP_ABOVE_AMOUNT: (env.SWAP_ABOVE_AMOUNT ?? "").trim(),
        SWAP_QUSD_USDC_RATE: (env.SWAP_QUSD_USDC_RATE ?? "").trim(),
        SWAP_USDC_QUSD_RATE: (env.SWAP_USDC_QUSD_RATE ?? "").trim(),
        SWAP_USDC_RECEIVE_ADDRESS: (env.SWAP_USDC_RECEIVE_ADDRESS ?? "").trim(),
        SWAP_MAXIMUM_USDC_AMOUNT: (env.SWAP_MAXIMUM_USDC_AMOUNT ?? "").trim(),
      };

      const [treasuryBalances, receiveBalances] = await Promise.all([
        fetchAddressBalances(env, env.SOLANA_TREASURY_ADDRESS),
        fetchAddressBalances(env, env.SWAP_USDC_RECEIVE_ADDRESS),
      ]);

      try {
        const swapCountRow = database
          .prepare(`SELECT COUNT(*) AS c FROM qusd_ledger WHERE entry_type = 'qusd_swap'`)
          .get() as { c: number };
        const swapTotal = Number(swapCountRow.c) || 0;
        const swapRows = database
          .prepare(
            `SELECT l.id, l.account_id, l.created_at, l.unlocked_delta, l.ref_id AS swap_id, a.email AS account_email
             FROM qusd_ledger l
             INNER JOIN accounts a ON a.id = l.account_id
             WHERE l.entry_type = 'qusd_swap'
             ORDER BY l.created_at DESC
             LIMIT ? OFFSET ?`,
          )
          .all(PAGE_SIZE, swapsOffset) as {
          id: number;
          account_id: string;
          created_at: number;
          unlocked_delta: number;
          swap_id: string;
          account_email: string | null;
        }[];

        const errCountRow = database
          .prepare(`SELECT COUNT(*) AS c FROM qusd_ledger WHERE entry_type = 'qusd_swap_refund'`)
          .get() as { c: number };
        const errTotal = Number(errCountRow.c) || 0;
        const errRows = database
          .prepare(
            `SELECT l.id, l.account_id, l.created_at, l.unlocked_delta, l.ref_id AS swap_id, a.email AS account_email
             FROM qusd_ledger l
             INNER JOIN accounts a ON a.id = l.account_id
             WHERE l.entry_type = 'qusd_swap_refund'
             ORDER BY l.created_at DESC
             LIMIT ? OFFSET ?`,
          )
          .all(PAGE_SIZE, errorsOffset) as {
          id: number;
          account_id: string;
          created_at: number;
          unlocked_delta: number;
          swap_id: string;
          account_email: string | null;
        }[];

        sendJson(res, 200, {
          env: envSnapshot,
          treasury: treasuryBalances,
          receive_address: receiveBalances,
          swaps: {
            page: swapsPage,
            page_size: PAGE_SIZE,
            total: swapTotal,
            rows: swapRows.map((r) => ({
              ...r,
              qusd_debited: Math.abs(Number(r.unlocked_delta) || 0),
            })),
          },
          swap_errors: {
            page: errorsPage,
            page_size: PAGE_SIZE,
            total: errTotal,
            rows: errRows.map((r) => ({
              ...r,
              qusd_refunded: Math.abs(Number(r.unlocked_delta) || 0),
              message: "On-chain USDC transfer failed; QUSD was refunded to the account.",
            })),
          },
        });
      } catch (e) {
        console.error("[admin-swap-dashboard] query:", e);
        sendJson(res, 500, { error: "query_failed" });
      }
    })();
  };
}
