/**
 * Sell QUSD (Solana): spend QUSD from the ledger; treasury sends QUEST to the verified receive address.
 *
 * GET /api/qusd/sell/config — public copy + QUEST mint.
 * GET /api/qusd/sell/me — auth: QUSD, verification, QUEST balance.
 * POST /api/qusd/sell — auth: spend QUSD, treasury sends QUEST to verified address.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";
import jwt from "jsonwebtoken";
import Database from "better-sqlite3";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { z } from "zod";
import { ensureAccountRowForEmail, resolveSolvequestDbPath } from "../server/accountEnsure";
import { ensureAccountsSchema } from "../server/ensureAccountsSchema";
import {
  getLedgerBalances,
  insertQuestPurchaseRefund,
  insertQuestPurchaseSpend,
} from "../server/qusdLedger";
import {
  ensureTreasuryQuestAta,
  preflightTreasuryQuestSend,
  sendQuestFromTreasuryToUser,
} from "../server/qusdSellTransfer";
import { resolveTreasurySigningKeypair } from "../server/treasurySigningKeypair";

type SqliteDb = InstanceType<typeof Database>;

const USER_COOKIE = "auth_token";

const sellBodyZ = z.object({
  qusd_amount: z.number().finite().positive(),
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

/** QUEST human amount (max 6 dp) from QUSD spend; then convert to mint raw using mint decimals. */
function questHumanToRaw(questHuman6dp: number, mintDecimals: number): bigint {
  const scaled = Math.round(questHuman6dp * 1_000_000);
  const m = BigInt(scaled);
  if (mintDecimals === 6) return m;
  if (mintDecimals > 6) {
    return m * 10n ** BigInt(mintDecimals - 6);
  }
  return m / 10n ** BigInt(6 - mintDecimals);
}

async function fetchQuestTokenBalanceHuman(
  connection: Connection,
  owner: PublicKey,
  questMint: PublicKey,
): Promise<number | null> {
  const mintInfo = await connection.getAccountInfo(questMint, "confirmed");
  if (!mintInfo) return null;
  const programId = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
  const mint = await getMint(connection, questMint, "confirmed", programId);
  const ata = getAssociatedTokenAddressSync(questMint, owner, false, programId);
  try {
    const acc = await getAccount(connection, ata, "confirmed", programId);
    return Number(acc.amount) / 10 ** mint.decimals;
  } catch {
    return 0;
  }
}

export function createQusdSellApiMiddleware(env: Record<string, string>, root: string): Connect.NextHandleFunction {
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
      return db;
    } catch (e) {
      console.error("[qusd-sell-api] open db:", e);
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

  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const url = req.url?.split("?")[0] ?? "";
    if (!url.startsWith("/api/qusd/sell")) {
      next();
      return;
    }

    if (req.method === "GET" && url === "/api/qusd/sell/config") {
      const prizeAmount = parseEnvNumber(env.PRIZE_AMOUNT, 0);
      const claimQuestAmount = parseEnvNumber(env.CLAIM_QUEST_AMOUNT, 0);
      const questMultiplier = parseEnvNumber(env.QUEST_MULTIPLIER, 1000);
      const questMint = (env.QUEST_MINT ?? "").trim();
      sendJson(res, 200, {
        prize_amount: prizeAmount,
        claim_quest_amount: claimQuestAmount,
        quest_multiplier: questMultiplier,
        quest_mint: questMint || null,
      });
      return;
    }

    if (!jwtOk) {
      sendJson(res, 503, { error: "auth_not_configured" });
      return;
    }

    if (req.method === "GET" && url === "/api/qusd/sell/me") {
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
          const row = loadOrCreateRow(payload.email.toLowerCase());
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
          const { unlocked, locked } = getLedgerBalances(database, accountId);
          const qusdUnlocked = unlocked + locked;
          const verifiedAt = row.sol_receive_verified_at as number | null | undefined;
          const verified = verifiedAt != null;
          const addr = (row.sol_receive_address as string | null | undefined)?.trim() || null;

          const questMintStr = (env.QUEST_MINT ?? "").trim();
          let questBalance: number | null = null;
          if (verified && addr && questMintStr) {
            try {
              const connection = new Connection(accountRpcUrl(env), "confirmed");
              const owner = new PublicKey(addr);
              const mint = new PublicKey(questMintStr);
              questBalance = await fetchQuestTokenBalanceHuman(connection, owner, mint);
            } catch (e) {
              console.error("[qusd-sell-api] quest balance:", e);
              questBalance = null;
            }
          }

          sendJson(res, 200, {
            qusd_unlocked: qusdUnlocked,
            sol_receive_verified: verified,
            sol_receive_address: addr,
            quest_balance: questBalance,
          });
        } catch (e) {
          console.error("[qusd-sell-api] GET /api/qusd/sell/me:", e);
          sendJson(res, 500, {
            error: "qusd_sell_me_failed",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      })();
      return;
    }

    if (req.method === "POST" && url === "/api/qusd/sell") {
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

        let body: z.infer<typeof sellBodyZ>;
        try {
          body = sellBodyZ.parse(JSON.parse((await readBody(req)) || "{}"));
        } catch (e) {
          sendJson(res, 400, {
            error: "invalid_body",
            message: e instanceof Error ? e.message : String(e),
          });
          return;
        }

        const questMintStr = (env.QUEST_MINT ?? "").trim();
        if (!questMintStr) {
          sendJson(res, 503, { error: "quest_mint_not_configured" });
          return;
        }

        const multiplier = parseEnvNumber(env.QUEST_MULTIPLIER, 1000);
        if (multiplier <= 0) {
          sendJson(res, 503, { error: "invalid_quest_multiplier" });
          return;
        }

        const qusdAmount = body.qusd_amount;
        const questHuman = Math.round((qusdAmount / multiplier) * 1e6) / 1e6;
        if (!Number.isFinite(questHuman) || questHuman <= 0) {
          sendJson(res, 400, {
            error: "quest_rounded_zero",
            message: "Amount is too small for the configured QUEST_MULTIPLIER (rounded QUEST would be zero).",
          });
          return;
        }

        try {
          const row = loadOrCreateRow(payload.email.toLowerCase());
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
          const verifiedAt = row.sol_receive_verified_at as number | null | undefined;
          if (verifiedAt == null) {
            sendJson(res, 403, {
              error: "sol_address_not_verified",
              message: "Verify your Solana address on the Account page before selling QUSD for QUEST.",
            });
            return;
          }
          const userAddrStr = (row.sol_receive_address as string | null | undefined)?.trim();
          if (!userAddrStr) {
            sendJson(res, 400, { error: "missing_sol_receive_address" });
            return;
          }

          let userOwner: PublicKey;
          try {
            userOwner = new PublicKey(userAddrStr);
          } catch {
            sendJson(res, 400, { error: "invalid_stored_address" });
            return;
          }

          const { unlocked, locked } = getLedgerBalances(database, accountId);
          const spendable = unlocked + locked;
          if (spendable + 1e-9 < qusdAmount) {
            sendJson(res, 400, {
              error: "insufficient_qusd",
              message: `Insufficient QUSD (have ${spendable.toFixed(2)}, need ${qusdAmount}).`,
            });
            return;
          }

          const treasuryResolved = resolveTreasurySigningKeypair(env);
          if (!treasuryResolved.ok) {
            sendJson(res, 503, { error: "treasury_key", message: treasuryResolved.reason });
            return;
          }
          const treasuryKp = treasuryResolved.keypair;

          const questMintPk = new PublicKey(questMintStr);
          const connection = new Connection(accountRpcUrl(env), "confirmed");

          const mintInfo = await connection.getAccountInfo(questMintPk, "confirmed");
          if (!mintInfo) {
            sendJson(res, 503, { error: "quest_mint_chain_missing" });
            return;
          }
          const tokenProgram = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
            ? TOKEN_2022_PROGRAM_ID
            : TOKEN_PROGRAM_ID;
          const mintMeta = await getMint(connection, questMintPk, "confirmed", tokenProgram);
          const amountRaw = questHumanToRaw(questHuman, mintMeta.decimals);
          if (amountRaw <= 0n) {
            sendJson(res, 400, { error: "quest_raw_zero" });
            return;
          }

          const ataOk = await ensureTreasuryQuestAta(connection, treasuryKp, questMintPk);
          if (!ataOk.ok) {
            sendJson(res, 503, { error: "treasury_quest_ata", message: ataOk.reason });
            return;
          }

          const pre = await preflightTreasuryQuestSend(
            connection,
            treasuryKp.publicKey,
            treasuryKp,
            questMintPk,
            userOwner,
            amountRaw,
          );
          if (!pre.ok) {
            sendJson(res, 400, { error: "treasury_preflight_failed", message: pre.reason });
            return;
          }

          const buyId = crypto.randomUUID();
          const now = Date.now();
          const runDebit = database.transaction(() => {
            insertQuestPurchaseSpend(database, accountId, qusdAmount, buyId, now);
            database
              .prepare(`UPDATE accounts SET updated_at = ?, sync_version = sync_version + 1 WHERE id = ?`)
              .run(now, accountId);
          });
          runDebit();

          const sent = await sendQuestFromTreasuryToUser(
            connection,
            treasuryKp,
            questMintPk,
            userOwner,
            amountRaw,
            pre.details,
          );

          if (!sent.ok) {
            const refundAt = Date.now();
            const runRefund = database.transaction(() => {
              insertQuestPurchaseRefund(database, accountId, qusdAmount, buyId, refundAt);
              database
                .prepare(`UPDATE accounts SET updated_at = ?, sync_version = sync_version + 1 WHERE id = ?`)
                .run(refundAt, accountId);
            });
            runRefund();
            sendJson(res, 502, {
              error: "quest_transfer_failed",
              message: sent.reason,
              buy_id: buyId,
            });
            return;
          }

          sendJson(res, 200, {
            ok: true,
            signature: sent.signature,
            qusd_spent: qusdAmount,
            quest_amount: questHuman,
            quest_raw: amountRaw.toString(),
            buy_id: buyId,
          });
        } catch (e) {
          console.error("[qusd-sell-api] POST /api/qusd/sell:", e);
          sendJson(res, 500, {
            error: "qusd_sell_failed",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      })();
      return;
    }

    next();
  };
}
