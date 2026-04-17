/**
 * QUSD → USDC swap: debit QUSD; treasury sends USDC to the user's verified Solana address.
 *
 * GET /api/config/buy-qusd-deposit — public: optional SWAP_USDC_RECEIVE_ADDRESS for Buy QUSD UI.
 * GET /api/swap/config — public: rate, limits.
 * GET /api/swap/preflight — auth: balances + treasury readiness.
 * POST /api/swap — auth: execute swap.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";
import jwt from "jsonwebtoken";
import Database from "better-sqlite3";
import { Connection, PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { ensureAccountRowForEmail, resolveSolvequestDbPath } from "../server/accountEnsure";
import { ensureAccountsSchema } from "../server/ensureAccountsSchema";
import { ensureVisitorsSchema } from "../server/ensureVisitorsSchema";
import { computeSwapAmounts } from "../src/lib/swapAmounts";
import {
  getLedgerBalances,
  insertQusdSwapRefund,
  insertQusdSwapSpend,
} from "../server/qusdLedger";
import { getUsdcAtaBalanceUi } from "../server/solanaUsdcScan";
import {
  ensureTreasuryUsdcAta,
  preflightTreasuryUsdcSend,
  sendUsdcFromTreasuryToUser,
} from "../server/usdcSwapTransfer";
import { resolveTreasurySigningKeypair } from "../server/treasurySigningKeypair";

type SqliteDb = InstanceType<typeof Database>;

const USER_COOKIE = "auth_token";

const swapBodyZ = z.object({
  qusd_amount: z.number().finite().positive(),
});

/** Minimum treasury SOL (lamports) for swap UI “ready” — 0.001 SOL. */
const MIN_TREASURY_SOL_LAMPORTS = 1_000_000;

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

function accountRpcUrl(env: Record<string, string>): string {
  return (
    env.SOLANA_RPC_URL?.trim() ||
    env.SOLANA_RPC_PROXY_TARGET?.trim() ||
    "https://api.mainnet-beta.solana.com"
  );
}

function parseEnvNumber(raw: string | undefined, fallback: number): number {
  const n = Number.parseFloat((raw ?? "").trim());
  return Number.isFinite(n) ? n : fallback;
}

/** Merge SOLANA_TREASURY_PRIVATE_KEY into SOLANA_TREASURY_KEY_B64 for resolveTreasurySigningKeypair. */
function envForTreasury(env: Record<string, string>): Record<string, string> {
  const out = { ...env };
  const pk = (env.SOLANA_TREASURY_PRIVATE_KEY ?? "").trim();
  if (pk && !(out.SOLANA_TREASURY_KEY_B64 ?? "").trim()) {
    out.SOLANA_TREASURY_KEY_B64 = pk;
  }
  return out;
}

export function createSwapApiMiddleware(env: Record<string, string>, root: string): Connect.NextHandleFunction {
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
      console.error("[swap-api] open db:", e);
      return null;
    }
  };

  const loadOrCreateRow = (email: string) => {
    const database = getDb();
    if (!database) return null;
    ensureAccountRowForEmail(database, email);
    return database.prepare(`SELECT * FROM accounts WHERE email = ?`).get(email.toLowerCase()) as
      | Record<string, unknown>
      | undefined;
  };

  const treasuryEnv = envForTreasury(env);
  const swapAbove = parseEnvNumber(env.SWAP_ABOVE_AMOUNT, 0);
  /** QUSD per 1 USDC; USDC out = QUSD ÷ rate (see `computeSwapAmounts`). */
  const swapRate = parseEnvNumber(env.SWAP_QUSD_USDC_RATE, 0);
  const swapMaxUsdc = parseEnvNumber(env.SWAP_MAXIMUM_USDC_AMOUNT, 0);
  const buyDepositAddr = (env.SWAP_USDC_RECEIVE_ADDRESS ?? "").trim();

  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const url = req.url?.split("?")[0] ?? "";
    if (url !== "/api/config/buy-qusd-deposit" && !url.startsWith("/api/swap")) {
      next();
      return;
    }

    if (url === "/api/config/buy-qusd-deposit" && req.method === "GET") {
      let addr: string | null = null;
      if (buyDepositAddr) {
        try {
          addr = new PublicKey(buyDepositAddr).toBase58();
        } catch {
          addr = null;
        }
      }
      const autoCreditUsdc =
        env.SOLVEQUEST_DEPOSIT_SCAN === "1" || env.SOLVEQUEST_DEPOSIT_SCAN === "true";
      sendJson(res, 200, { address: addr, auto_credit_usdc_enabled: autoCreditUsdc });
      return;
    }

    if (url === "/api/swap/config" && req.method === "GET") {
      sendJson(res, 200, {
        swap_above_amount: swapAbove,
        swap_qusd_usdc_rate: swapRate,
        swap_maximum_usdc_amount: swapMaxUsdc,
        swap_enabled: swapAbove > 0 && swapRate > 0 && swapMaxUsdc > 0,
      });
      return;
    }

    if (url === "/api/swap/preflight" && req.method === "GET") {
      void (async () => {
        if (!jwtOk) {
          sendJson(res, 503, { error: "auth_not_configured" });
          return;
        }
        const token = parseCookies(req.headers.cookie)[USER_COOKIE];
        if (!token) {
          sendJson(res, 401, { error: "not_authenticated" });
          return;
        }
        let email: string;
        try {
          const p = jwt.verify(token, jwtSecret!) as { email?: string };
          if (!p.email || typeof p.email !== "string") {
            sendJson(res, 401, { error: "invalid_token" });
            return;
          }
          email = p.email.toLowerCase();
        } catch {
          sendJson(res, 401, { error: "invalid_token" });
          return;
        }

        const database = getDb();
        if (!database) {
          sendJson(res, 503, { error: "db_missing" });
          return;
        }

        const row = loadOrCreateRow(email);
        if (!row?.id) {
          sendJson(res, 503, { error: "no_account" });
          return;
        }

        const accountId = String(row.id);
        const { unlocked, locked } = getLedgerBalances(database, accountId);
        const qusdUnlocked = unlocked + locked;
        const verifiedAt = row.sol_receive_verified_at as number | null | undefined;
        const verified = verifiedAt != null;
        const userAddr = ((row.sol_receive_address as string | null) ?? "").trim();

        let treasuryUsdc = 0;
        let treasurySolLamports = 0;
        let treasuryReady = false;
        const treasuryPkStr = (env.SOLANA_TREASURY_ADDRESS ?? "").trim();
        if (treasuryPkStr) {
          try {
            const connection = new Connection(accountRpcUrl(env), "confirmed");
            const treasuryPk = new PublicKey(treasuryPkStr);
            treasuryUsdc = await getUsdcAtaBalanceUi(connection, treasuryPk);
            treasurySolLamports = await connection.getBalance(treasuryPk, "confirmed");
            treasuryReady =
              treasuryUsdc > 0 &&
              treasurySolLamports >= MIN_TREASURY_SOL_LAMPORTS &&
              swapAbove > 0 &&
              swapRate > 0 &&
              swapMaxUsdc > 0;
          } catch (e) {
            console.error("[swap-api] preflight chain:", e);
          }
        }

        sendJson(res, 200, {
          swap_above_amount: swapAbove,
          swap_qusd_usdc_rate: swapRate,
          swap_maximum_usdc_amount: swapMaxUsdc,
          qusd_unlocked: qusdUnlocked,
          sol_receive_verified: verified,
          sol_receive_address: userAddr || null,
          treasury_usdc: treasuryUsdc,
          treasury_sol_lamports: treasurySolLamports,
          treasury_ready: treasuryReady,
          min_treasury_sol_lamports: MIN_TREASURY_SOL_LAMPORTS,
        });
      })();
      return;
    }

    if (url === "/api/swap" && req.method === "POST") {
      void (async () => {
        if (!jwtOk) {
          sendJson(res, 503, { error: "auth_not_configured", message: "JWT not configured." });
          return;
        }
        const token = parseCookies(req.headers.cookie)[USER_COOKIE];
        if (!token) {
          sendJson(res, 401, { error: "not_authenticated" });
          return;
        }
        let email: string;
        try {
          const p = jwt.verify(token, jwtSecret!) as { email?: string };
          if (!p.email || typeof p.email !== "string") {
            sendJson(res, 401, { error: "invalid_token" });
            return;
          }
          email = p.email.toLowerCase();
        } catch {
          sendJson(res, 401, { error: "invalid_token" });
          return;
        }

        let body: z.infer<typeof swapBodyZ>;
        try {
          body = swapBodyZ.parse(JSON.parse((await readBody(req)) || "{}"));
        } catch (e) {
          sendJson(res, 400, {
            error: "invalid_body",
            message: e instanceof Error ? e.message : String(e),
          });
          return;
        }

        if (swapAbove <= 0 || swapRate <= 0 || swapMaxUsdc <= 0) {
          sendJson(res, 503, {
            error: "swap_not_configured",
            message: "Swap is not configured (set SWAP_ABOVE_AMOUNT, SWAP_QUSD_USDC_RATE, SWAP_MAXIMUM_USDC_AMOUNT).",
          });
          return;
        }

        const database = getDb();
        if (!database) {
          sendJson(res, 503, { error: "db_missing" });
          return;
        }

        const row = loadOrCreateRow(email);
        if (!row?.id) {
          sendJson(res, 503, { error: "no_account" });
          return;
        }

        const accountId = String(row.id);
        if (row.sol_receive_verified_at == null) {
          sendJson(res, 403, {
            error: "sol_not_verified",
            message: "Verify your Solana address on the Account page before swapping.",
          });
          return;
        }

        const userAddrStr = String((row.sol_receive_address as string | null | undefined) ?? "").trim();
        if (!userAddrStr) {
          sendJson(res, 400, { error: "missing_address", message: "No Solana receive address on file." });
          return;
        }

        let userOwner: PublicKey;
        try {
          userOwner = new PublicKey(userAddrStr);
        } catch {
          sendJson(res, 400, { error: "invalid_address", message: "Stored wallet address is invalid." });
          return;
        }

        const qusdIn = body.qusd_amount;
        if (!(qusdIn > swapAbove)) {
          sendJson(res, 400, {
            error: "below_minimum",
            message: `Amount must be greater than ${swapAbove} QUSD.`,
          });
          return;
        }

        const { unlocked, locked } = getLedgerBalances(database, accountId);
        const spendable = unlocked + locked;
        if (spendable + 1e-9 < qusdIn) {
          sendJson(res, 400, {
            error: "insufficient_qusd",
            message: `Not enough QUSD. You have ${spendable.toFixed(2)} QUSD.`,
          });
          return;
        }

        const treasuryResolved = resolveTreasurySigningKeypair(treasuryEnv);
        if (!treasuryResolved.ok) {
          sendJson(res, 503, {
            error: "treasury_key",
            message: treasuryResolved.reason,
          });
          return;
        }
        const treasuryKp = treasuryResolved.keypair;
        const connection = new Connection(accountRpcUrl(env), "confirmed");

        const treasuryUsdcUi = await getUsdcAtaBalanceUi(connection, treasuryKp.publicKey);
        const treasurySol = await connection.getBalance(treasuryKp.publicKey, "confirmed");

        if (treasuryUsdcUi <= 0) {
          sendJson(res, 400, { error: "treasury_no_usdc", message: "Treasury has no USDC available." });
          return;
        }
        if (treasurySol < MIN_TREASURY_SOL_LAMPORTS) {
          sendJson(res, 400, {
            error: "treasury_low_sol",
            message: `Treasury needs at least ${MIN_TREASURY_SOL_LAMPORTS} lamports (0.001 SOL) for fees.`,
          });
          return;
        }

        const { qusdDebit, usdcOut } = computeSwapAmounts(qusdIn, swapRate, swapMaxUsdc, treasuryUsdcUi);
        if (usdcOut <= 0 || qusdDebit <= 0) {
          sendJson(res, 400, {
            error: "zero_after_caps",
            message: "Amount is too small after limits and treasury balance, or treasury cannot cover this swap.",
          });
          return;
        }

        if (spendable + 1e-9 < qusdDebit) {
          sendJson(res, 400, { error: "insufficient_qusd", message: "Not enough QUSD after applying limits." });
          return;
        }

        const amountRaw = BigInt(Math.round(usdcOut * 1e6));

        const ataOk = await ensureTreasuryUsdcAta(connection, treasuryKp);
        if (!ataOk.ok) {
          sendJson(res, 503, { error: "treasury_usdc_ata", message: ataOk.reason });
          return;
        }

        const pre = await preflightTreasuryUsdcSend(
          connection,
          treasuryKp.publicKey,
          treasuryKp,
          userOwner,
          amountRaw,
        );
        if (!pre.ok) {
          sendJson(res, 400, { error: "preflight_failed", message: pre.reason });
          return;
        }

        const swapId = crypto.randomUUID();
        const now = Date.now();
        const runDebit = database.transaction(() => {
          insertQusdSwapSpend(database, accountId, qusdDebit, swapId, now);
          database
            .prepare(`UPDATE accounts SET updated_at = ?, sync_version = sync_version + 1 WHERE id = ?`)
            .run(now, accountId);
        });
        runDebit();

        const sent = await sendUsdcFromTreasuryToUser(connection, treasuryKp, userOwner, amountRaw, pre.details);

        if (!sent.ok) {
          const refundAt = Date.now();
          const runRefund = database.transaction(() => {
            insertQusdSwapRefund(database, accountId, qusdDebit, swapId, refundAt);
            database
              .prepare(`UPDATE accounts SET updated_at = ?, sync_version = sync_version + 1 WHERE id = ?`)
              .run(refundAt, accountId);
          });
          runRefund();
          sendJson(res, 502, {
            error: "usdc_transfer_failed",
            message: sent.reason,
            swap_id: swapId,
          });
          return;
        }

        sendJson(res, 200, {
          ok: true,
          signature: sent.signature,
          qusd_debited: qusdDebit,
          usdc_sent: usdcOut,
          swap_id: swapId,
          message: "USDC sent to your verified Solana address.",
        });
      })();
      return;
    }

    next();
  };
}
