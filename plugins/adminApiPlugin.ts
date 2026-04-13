/**
 * Dev/preview middleware: admin nonce + signature verification + session cookie.
 * Reads ADMIN_SOLANA_ADDRESS from env (comma-separated base58 pubkeys). Server-only.
 */
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";
import type { Plugin } from "vite";
import { loadEnv } from "vite";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

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

export function createAdminApiMiddleware(
  env: Record<string, string>,
  mode: string,
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
      const sid = parseCookies(req.headers.cookie)[COOKIE];
      if (!sid || !sessions.has(sid)) {
        sendJson(res, 200, { ok: false, authenticated: false });
        return;
      }
      const s = sessions.get(sid)!;
      if (s.exp <= Date.now()) {
        sessions.delete(sid);
        sendJson(res, 200, { ok: false, authenticated: false });
        return;
      }
      sendJson(res, 200, { ok: true, authenticated: true, pubkey: s.pubkey });
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
    server.middlewares.use(createAdminApiMiddleware(env, server.config.mode));
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
