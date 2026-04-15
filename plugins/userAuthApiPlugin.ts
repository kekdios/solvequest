/**
 * Email OTP + JWT session (Vite dev/preview middleware). Mirrors cryptomasspay /api/auth/*.
 * Env: RESEND_API_KEY, EMAIL_FROM_AUTH, JWT_SECRET, optional JWT_EXPIRES_IN / JWT_REMEMBER_EXPIRES_IN.
 * Defaults match cryptomasspay server/lib/jwt-service.ts (7d / 7d).
 */
import { randomInt, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";
import type { Plugin } from "vite";
import { loadEnv } from "vite";
import jwt, { type SignOptions } from "jsonwebtoken";
import Database from "better-sqlite3";
import { Resend } from "resend";
import { z } from "zod";
import { ensureAccountRowForEmail, resolveSolvequestDbPath } from "../server/accountEnsure";
import { ensureCustodialHdSchema } from "../server/ensureCustodialHdSchema";
import { insertEmailOtpVerificationBonus } from "../server/qusdLedger";

const USER_COOKIE = "auth_token";

type OtpEntry = { code: string; expires: number; attempts: number };
const otpStore = new Map<string, OtpEntry>();
const OTP_EXPIRY_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const sendHistory = new Map<string, number[]>();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [email, entry] of otpStore.entries()) {
    if (now > entry.expires) otpStore.delete(email);
  }
}, 5 * 60 * 1000);

function generateOtp(): string {
  return randomInt(100000, 1000000).toString();
}

function saveOtp(email: string, code: string): void {
  otpStore.set(email.toLowerCase(), {
    code,
    expires: Date.now() + OTP_EXPIRY_MS,
    attempts: 0,
  });
}

function verifyOtp(email: string, code: string): boolean {
  const key = email.toLowerCase();
  const entry = otpStore.get(key);
  if (!entry) return false;
  if (Date.now() > entry.expires) {
    otpStore.delete(key);
    return false;
  }
  if (entry.attempts >= MAX_ATTEMPTS) {
    otpStore.delete(key);
    return false;
  }
  entry.attempts++;
  const a = Buffer.from(entry.code, "utf8");
  const b = Buffer.from(code, "utf8");
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;
  otpStore.delete(key);
  return true;
}

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

function clientIp(req: IncomingMessage): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string") return xff.split(",")[0]?.trim() ?? "unknown";
  return req.socket?.remoteAddress ?? "unknown";
}

function rateAllowed(ip: string): boolean {
  const now = Date.now();
  const arr = sendHistory.get(ip) ?? [];
  const recent = arr.filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  sendHistory.set(ip, recent);
  return true;
}

function clearAuthCookie(res: ServerResponse, secure: boolean) {
  const tail = secure ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${USER_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${tail}`,
  );
}

function setAuthCookie(res: ServerResponse, token: string, maxAgeSec: number, secure: boolean) {
  const tail = secure ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${USER_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${tail}`,
  );
}

async function sendOtpEmail(
  env: Record<string, string>,
  email: string,
  code: string,
): Promise<void> {
  const from = env.EMAIL_FROM_AUTH;
  if (!from) throw new Error("EMAIL_FROM_AUTH is not set");
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");

  const appName = env.APP_NAME ?? "SolveQuest";
  const resend = new Resend(env.RESEND_API_KEY);

  const result = await resend.emails.send({
    from,
    to: email,
    subject: `Sign in to ${appName}`,
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;font-family:system-ui,-apple-system,sans-serif;background:#f5f5f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px;"><tr><td align="center">
<table width="100%" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
<tr><td style="background:linear-gradient(135deg,#1e293b,#0f172a);padding:28px;text-align:center;">
<h1 style="margin:0;color:#fff;font-size:22px;">${appName}</h1>
<p style="margin:8px 0 0;color:#94a3b8;font-size:13px;">Email verification</p></td></tr>
<tr><td style="padding:32px 28px;">
<p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.5;">Your verification code is:</p>
<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px;text-align:center;">
<span style="font-size:32px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,monospace;color:#0f172a;">${code}</span>
</div>
<p style="margin:20px 0 0;color:#64748b;font-size:13px;">This code expires in 10 minutes. If you didn’t request it, you can ignore this email.</p>
</td></tr></table></td></tr></table></body></html>`,
  });

  if (!result.data || result.error) {
    const errorMsg = result.error?.message ?? "Unknown error";
    if (errorMsg.includes("testing emails")) {
      throw new Error(
        "Email is in Resend testing mode. Verify a domain at resend.com/domains to send to any address.",
      );
    }
    throw new Error(errorMsg);
  }
}

function expiresInToSeconds(exp: string): number {
  const t = exp.trim();
  const m = /^(\d+)\s*([smhd])$/i.exec(t);
  if (m) {
    const n = parseInt(m[1]!, 10);
    const u = m[2]!.toLowerCase();
    const mult = u === "s" ? 1 : u === "m" ? 60 : u === "h" ? 3600 : 86400;
    return n * mult;
  }
  const raw = Number(t);
  if (!Number.isNaN(raw) && raw > 0) return Math.floor(raw);
  return 86400;
}

export function createUserAuthMiddleware(env: Record<string, string>, mode: string): Connect.NextHandleFunction {
  const jwtSecret = env.JWT_SECRET;
  const sessionExp = env.JWT_EXPIRES_IN ?? "7d";
  const rememberExp = env.JWT_REMEMBER_EXPIRES_IN ?? "7d";
  const secure = mode === "production" || env.VITE_AUTH_COOKIE_SECURE === "1";
  const jwtOk = Boolean(jwtSecret && jwtSecret !== "change-this-secret-key");

  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const url = req.url?.split("?")[0] ?? "";
    if (!url.startsWith("/api/auth")) {
      next();
      return;
    }

    if (!jwtOk) {
      sendJson(res, 503, { error: "auth_not_configured", message: "Set JWT_SECRET in .env" });
      return;
    }

    if (req.method === "POST" && url === "/api/auth/send-otp") {
      void readBody(req).then(async (raw) => {
        try {
          const ip = clientIp(req);
          if (!rateAllowed(ip)) {
            sendJson(res, 429, { error: "Too many requests. Try again later." });
            return;
          }

          const { email } = z.object({ email: z.string().email().toLowerCase() }).parse(JSON.parse(raw || "{}"));
          const code = generateOtp();
          saveOtp(email, code);

          try {
            await sendOtpEmail(env, email, code);
          } catch (e: unknown) {
            otpStore.delete(email.toLowerCase());
            const msg = e instanceof Error ? e.message : "Failed to send email";
            if (msg.includes("testing mode") || msg.includes("Resend")) {
              sendJson(res, 503, { error: msg });
              return;
            }
            console.error("[user-auth] send email:", e);
            sendJson(res, 500, { error: "Failed to send verification code." });
            return;
          }

          sendJson(res, 200, { success: true, message: "Verification code sent" });
        } catch (e: unknown) {
          if (e instanceof z.ZodError) {
            sendJson(res, 400, { error: "Invalid email address" });
            return;
          }
          console.error("[user-auth] send-otp:", e);
          sendJson(res, 500, { error: "Failed to send verification code" });
        }
      });
      return;
    }

    if (req.method === "POST" && url === "/api/auth/verify-otp") {
      void readBody(req).then((raw) => {
        try {
          const { email, code, rememberMe } = z
            .object({
              email: z.string().email().toLowerCase(),
              code: z.string().length(6).regex(/^\d+$/),
              rememberMe: z.boolean().optional().default(false),
            })
            .parse(JSON.parse(raw || "{}"));

          if (!verifyOtp(email, code)) {
            sendJson(res, 401, { error: "Invalid or expired verification code" });
            return;
          }

          try {
            const root = process.cwd();
            const dbPath = resolveSolvequestDbPath(root, env);
            if (fs.existsSync(dbPath)) {
              const database = new Database(dbPath);
              database.pragma("foreign_keys = ON");
              database.pragma("journal_mode = WAL");
              database.pragma("busy_timeout = 8000");
              ensureCustodialHdSchema(database);
              const { accountId } = ensureAccountRowForEmail(database, email);
              insertEmailOtpVerificationBonus(database, accountId, Date.now());
              database.close();
            }
          } catch (e) {
            console.error("[user-auth] email OTP QUSD bonus:", e);
          }

          const expiresIn = rememberMe ? rememberExp : sessionExp;
          const signOpts = { expiresIn } as SignOptions;
          const token = jwt.sign({ email }, jwtSecret!, signOpts);
          const maxAgeSec = expiresInToSeconds(
            typeof expiresIn === "string" ? expiresIn : String(expiresIn),
          );

          setAuthCookie(res, token, maxAgeSec, secure);
          sendJson(res, 200, {
            success: true,
            user: { email },
          });
        } catch (e: unknown) {
          if (e instanceof z.ZodError) {
            sendJson(res, 400, { error: "Invalid input" });
            return;
          }
          console.error("[user-auth] verify-otp:", e);
          sendJson(res, 500, { error: "Failed to verify code" });
        }
      });
      return;
    }

    if (req.method === "POST" && url === "/api/auth/logout") {
      clearAuthCookie(res, secure);
      sendJson(res, 200, { success: true });
      return;
    }

    if (req.method === "GET" && url === "/api/auth/me") {
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
        sendJson(res, 200, { user: { email: payload.email } });
      } catch {
        sendJson(res, 401, { error: "Invalid token" });
      }
      return;
    }

    sendJson(res, 404, { error: "not_found" });
  };
}

export function userAuthApiPlugin(): Plugin {
  const attach = (server: {
    middlewares: Connect.Server;
    config: { root: string; mode: string; logger: { warn: (s: string) => void } };
  }) => {
    const env = {
      ...process.env,
      ...loadEnv(server.config.mode, server.config.root, ""),
    } as Record<string, string>;
    if (!env.JWT_SECRET || env.JWT_SECRET === "change-this-secret-key") {
      server.config.logger.warn(
        "solvequest-user-auth: set JWT_SECRET in .env to enable /api/auth (email OTP + sessions)",
      );
    }
    if (!env.RESEND_API_KEY) {
      server.config.logger.warn("solvequest-user-auth: set RESEND_API_KEY in .env to send OTP emails");
    }
    if (!env.EMAIL_FROM_AUTH) {
      server.config.logger.warn("solvequest-user-auth: set EMAIL_FROM_AUTH (e.g. onboarding@yourdomain.com)");
    }
    server.middlewares.use(createUserAuthMiddleware(env, server.config.mode));
  };

  return {
    name: "solvequest-user-auth",
    configureServer(server) {
      attach(server);
    },
    configurePreviewServer(server) {
      attach(server);
    },
  };
}
