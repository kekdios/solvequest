/**
 * Dev/preview middleware: admin nonce + signature verification + session cookie.
 * Reads ADMIN_SOLANA_ADDRESS from env (comma-separated base58 pubkeys). Server-only.
 */
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";
import type { Plugin } from "vite";
import { loadEnv } from "vite";
import { Connection, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { runCustodialSweepOrchestration } from "../server/adminCustodialSweepOrchestrator";
import { getSweepFeePayerPubkeyInfo } from "../server/custodialSweepServer";
import { runDepositScanOnce } from "../server/depositScanWorker";
import { getUsdcAta, MAINNET_USDC_MINT } from "../server/solanaUsdcScan";

const COOKIE = "sq_admin_session";
const NONCE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

type NonceEntry = { message: string; exp: number };
type SessionEntry = { pubkey: string; exp: number };

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
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

function buildMessage(nonce: string): string {
  const issued = new Date().toISOString();
  return [
    "Solve Quest — admin sign-in",
    "",
    `Nonce: ${nonce}`,
    `Issued (UTC): ${issued}`,
    `Valid for: ${NONCE_TTL_MS / 60000} minutes`,
    "",
    "Signing proves control of this wallet. The server checks your pubkey against ADMIN_SOLANA_ADDRESS.",
  ].join("\n");
}

function adminSessionOk(
  cookieHeader: string | undefined,
  sessions: Map<string, SessionEntry>,
): SessionEntry | null {
  const sid = parseCookies(cookieHeader)[COOKIE];
  if (!sid || !sessions.has(sid)) return null;
  const s = sessions.get(sid)!;
  if (s.exp <= Date.now()) {
    sessions.delete(sid);
    return null;
  }
  return s;
}

export function createAdminApiMiddleware(
  env: Record<string, string>,
  mode: string,
  appRoot: string,
): Connect.NextHandleFunction {
  const raw = env.ADMIN_SOLANA_ADDRESS ?? "";
  const allow = new Set<string>();
  for (const part of raw.split(",")) {
    const s = part.trim();
    if (!s) continue;
    try {
      allow.add(new PublicKey(s).toBase58());
    } catch {
      /* skip invalid */
    }
  }

  const nonces = new Map<string, NonceEntry>();
  const sessions = new Map<string, SessionEntry>();

  const sweep = () => {
    const now = Date.now();
    for (const [k, v] of nonces) {
      if (v.exp <= now) nonces.delete(k);
    }
    for (const [k, v] of sessions) {
      if (v.exp <= now) sessions.delete(k);
    }
  };

  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const url = req.url?.split("?")[0] ?? "";
    if (!url.startsWith("/api/admin")) {
      next();
      return;
    }

    if (allow.size === 0) {
      sendJson(res, 503, { ok: false, error: "admin_api_disabled" });
      return;
    }

    sweep();

    const secure = mode === "production" || env.VITE_ADMIN_COOKIE_SECURE === "1";
    const cookieAttrs = [
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      secure ? "Secure" : "",
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    ]
      .filter(Boolean)
      .join("; ");

    if (req.method === "GET" && url === "/api/admin/nonce") {
      const nonce = randomBytes(16).toString("hex");
      const message = buildMessage(nonce);
      nonces.set(nonce, { message, exp: Date.now() + NONCE_TTL_MS });
      sendJson(res, 200, { ok: true, nonce, message });
      return;
    }

    if (req.method === "GET" && url === "/api/admin/me") {
      const s = adminSessionOk(req.headers.cookie, sessions);
      if (!s) {
        sendJson(res, 200, { ok: false, authenticated: false });
        return;
      }
      sendJson(res, 200, { ok: true, authenticated: true, pubkey: s.pubkey });
      return;
    }

    /** Server RPC snapshot for custodial deposit owner — set SOLVEQUEST_ADMIN_CUSTODY_OWNER in .env (base58). */
    if (req.method === "GET" && url === "/api/admin/custody-debug") {
      const sess = adminSessionOk(req.headers.cookie, sessions);
      if (!sess) {
        sendJson(res, 401, { ok: false, error: "unauthorized" });
        return;
      }
      const rawOwner = (process.env.SOLVEQUEST_ADMIN_CUSTODY_OWNER ?? env.SOLVEQUEST_ADMIN_CUSTODY_OWNER ?? "").trim();
      const rpcDefault =
        process.env.SOLANA_RPC_URL?.trim() ||
        process.env.SOLANA_RPC_PROXY_TARGET?.trim() ||
        "https://api.mainnet-beta.solana.com";

      if (!rawOwner) {
        sendJson(res, 200, {
          ok: true,
          configured: false,
          owner: null,
          usdc_ata: null,
          usdc_mint: MAINNET_USDC_MINT.toBase58(),
          sol_lamports: null,
          usdc_balance_ui: null,
          ata_exists: false,
          recent_signatures: [] as { signature: string; slot: number | null; blockTime: number | null }[],
          rpc_url: rpcDefault,
        });
        return;
      }

      let ownerPk: PublicKey;
      try {
        ownerPk = new PublicKey(rawOwner);
      } catch {
        sendJson(res, 500, { ok: false, error: "invalid_SOLVEQUEST_ADMIN_CUSTODY_OWNER" });
        return;
      }

      const ataPk = getUsdcAta(ownerPk);
      void (async () => {
        try {
          const conn = new Connection(rpcDefault, "confirmed");
          const [solLamports, sigs, tokenBal] = await Promise.all([
            conn.getBalance(ownerPk, "confirmed"),
            conn.getSignaturesForAddress(ataPk, { limit: 20 }),
            conn.getTokenAccountBalance(ataPk).catch(() => null),
          ]);
          const usdcUi = tokenBal != null ? parseFloat(tokenBal.value.uiAmountString ?? "0") : 0;
          sendJson(res, 200, {
            ok: true,
            configured: true,
            owner: rawOwner,
            usdc_ata: ataPk.toBase58(),
            usdc_mint: MAINNET_USDC_MINT.toBase58(),
            sol_lamports: solLamports,
            usdc_balance_ui: usdcUi,
            ata_exists: tokenBal != null,
            recent_signatures: sigs.map((x) => ({
              signature: x.signature,
              slot: x.slot ?? null,
              blockTime: x.blockTime ?? null,
            })),
            rpc_url: rpcDefault,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          sendJson(res, 200, {
            ok: true,
            configured: true,
            owner: rawOwner,
            usdc_ata: ataPk.toBase58(),
            usdc_mint: MAINNET_USDC_MINT.toBase58(),
            sol_lamports: null,
            usdc_balance_ui: null,
            ata_exists: false,
            recent_signatures: [] as { signature: string; slot: number | null; blockTime: number | null }[],
            rpc_url: rpcDefault,
            rpc_error: msg,
          });
        }
      })();
      return;
    }

    /** Sweep fee payer pubkey (central fees) — for funding SOL; no secrets returned. */
    if (req.method === "GET" && url === "/api/admin/sweep-fee-payer-info") {
      const sess = adminSessionOk(req.headers.cookie, sessions);
      if (!sess) {
        sendJson(res, 401, { ok: false, error: "unauthorized" });
        return;
      }
      const envMerged = { ...process.env, ...env } as NodeJS.ProcessEnv;
      const info = getSweepFeePayerPubkeyInfo(envMerged);
      const rpcDefault =
        envMerged.SOLANA_RPC_URL?.trim() ||
        envMerged.SOLANA_RPC_PROXY_TARGET?.trim() ||
        "https://api.mainnet-beta.solana.com";

      if (info.mode === "custodial_pays" || info.mode === "config_error") {
        sendJson(res, 200, {
          ok: true,
          ...info,
          sol_lamports: null as number | null,
          rpc_url: rpcDefault,
        });
        return;
      }

      let ownerPk: PublicKey;
      try {
        ownerPk = new PublicKey(info.pubkey);
      } catch {
        sendJson(res, 200, {
          ok: true,
          ...info,
          sol_lamports: null,
          rpc_url: rpcDefault,
          rpc_error: "invalid_pubkey",
        });
        return;
      }

      void (async () => {
        try {
          const conn = new Connection(rpcDefault, "confirmed");
          const solLamports = await conn.getBalance(ownerPk, "confirmed");
          sendJson(res, 200, {
            ok: true,
            ...info,
            sol_lamports: solLamports,
            rpc_url: rpcDefault,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          sendJson(res, 200, {
            ok: true,
            ...info,
            sol_lamports: null,
            rpc_url: rpcDefault,
            rpc_error: msg,
          });
        }
      })();
      return;
    }

    if (req.method === "POST" && url === "/api/admin/deposit-scan") {
      if (!adminSessionOk(req.headers.cookie, sessions)) {
        sendJson(res, 401, { ok: false, error: "unauthorized" });
        return;
      }
      void runDepositScanOnce(appRoot, process.env).then((result) => {
        if (result.ok) {
          sendJson(res, 200, {
            ok: true,
            accountsScanned: result.accountsScanned,
          });
        } else {
          sendJson(res, 500, { ok: false, error: result.error });
        }
      });
      return;
    }

    if (req.method === "POST" && url === "/api/admin/custodial-sweep") {
      if (!adminSessionOk(req.headers.cookie, sessions)) {
        sendJson(res, 401, { ok: false, error: "unauthorized" });
        return;
      }
      void readBody(req).then((raw) => {
        let parsed: { account_id?: string } = {};
        try {
          if (raw && raw.trim()) parsed = JSON.parse(raw) as { account_id?: string };
        } catch {
          sendJson(res, 400, { ok: false, error: "invalid_json" });
          return;
        }
        const envMerged = { ...process.env, ...env };
        void runCustodialSweepOrchestration(appRoot, envMerged, parsed)
          .then((result) => {
            sendJson(res, 200, result);
          })
          .catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            console.error("[admin] custodial-sweep:", e);
            sendJson(res, 500, {
              ok: false,
              error: msg,
              steps: [] as { id: string; label: string; status: "error"; detail?: string }[],
            });
          });
      });
      return;
    }

    if (req.method === "POST" && url === "/api/admin/logout") {
      const sid = parseCookies(req.headers.cookie)[COOKIE];
      if (sid) sessions.delete(sid);
      res.statusCode = 204;
      res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`);
      res.end();
      return;
    }

    if (req.method === "POST" && url === "/api/admin/verify") {
      void readBody(req).then((rawBody) => {
        try {
          const body = JSON.parse(rawBody) as {
            nonce?: string;
            message?: string;
            pubkey?: string;
            signature?: string;
          };
          const { nonce, message, pubkey, signature } = body;
          if (!nonce || !message || !pubkey || !signature) {
            sendJson(res, 400, { ok: false, error: "missing_fields" });
            return;
          }
          const entry = nonces.get(nonce);
          if (!entry || entry.exp <= Date.now()) {
            sendJson(res, 401, { ok: false, error: "nonce_invalid" });
            return;
          }
          if (entry.message !== message) {
            sendJson(res, 401, { ok: false, error: "message_mismatch" });
            return;
          }

          let pubkeyBytes: Uint8Array;
          let signer: string;
          try {
            const pk = new PublicKey(pubkey);
            pubkeyBytes = pk.toBytes();
            signer = pk.toBase58();
          } catch {
            sendJson(res, 400, { ok: false, error: "bad_pubkey" });
            return;
          }

          if (!allow.has(signer)) {
            sendJson(res, 403, { ok: false, error: "not_admin" });
            return;
          }

          let sigBytes: Uint8Array;
          try {
            const buf = Buffer.from(signature, "base64");
            sigBytes = new Uint8Array(buf);
          } catch {
            sendJson(res, 400, { ok: false, error: "bad_signature_encoding" });
            return;
          }
          if (sigBytes.length !== 64) {
            sendJson(res, 400, { ok: false, error: "bad_signature_length" });
            return;
          }

          const msgBytes = new TextEncoder().encode(message);
          if (!nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes)) {
            sendJson(res, 401, { ok: false, error: "bad_signature" });
            return;
          }

          nonces.delete(nonce);
          const sid = randomBytes(32).toString("hex");
          sessions.set(sid, { pubkey: signer, exp: Date.now() + SESSION_TTL_MS });

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Set-Cookie", `${COOKIE}=${sid}; ${cookieAttrs}`);
          res.end(JSON.stringify({ ok: true, pubkey: signer }));
        } catch {
          sendJson(res, 400, { ok: false, error: "invalid_json" });
        }
      });
      return;
    }

    sendJson(res, 404, { ok: false, error: "not_found" });
  };
}

export function adminApiPlugin(): Plugin {
  const attach = (server: {
    middlewares: Connect.Server;
    config: { root: string; mode: string; logger: { warn: (s: string) => void } };
  }) => {
    const env = {
      ...process.env,
      ...loadEnv(server.config.mode, server.config.root, ""),
    } as Record<string, string>;
    const raw = env.ADMIN_SOLANA_ADDRESS ?? "";
    if (!raw.trim()) {
      server.config.logger.warn("solvequest-admin-api: set ADMIN_SOLANA_ADDRESS in .env to enable /api/admin");
      return;
    }
    server.middlewares.use(createAdminApiMiddleware(env, server.config.mode, server.config.root));
  };

  return {
    name: "solvequest-admin-api",
    configureServer(server) {
      attach(server);
    },
    configurePreviewServer(server) {
      attach(server);
    },
  };
}
