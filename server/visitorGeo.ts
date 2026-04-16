/**
 * Client IP from reverse-proxy headers / socket; offline geo label via geoip-lite.
 */
import { createRequire } from "node:module";
import type { IncomingMessage } from "node:http";

const require = createRequire(import.meta.url);
const geoip = require("geoip-lite") as {
  lookup: (ip: string) => null | { country: string; region: string; city: string };
};

type ReqWithIp = IncomingMessage & { ip?: string };

function normalizeIp(raw: string): string {
  return raw.replace(/^::ffff:/, "").trim() || "unknown";
}

export function getClientIp(req: ReqWithIp): string {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) {
    const first = xf.split(",")[0]?.trim();
    if (first) return normalizeIp(first);
  }
  const xr = req.headers["x-real-ip"];
  if (typeof xr === "string" && xr.trim()) return normalizeIp(xr.trim());
  if (req.ip && typeof req.ip === "string") return normalizeIp(req.ip);
  const raw = req.socket?.remoteAddress ?? "";
  return normalizeIp(raw);
}

function isPrivateOrLocal(ip: string): boolean {
  const i = ip.toLowerCase();
  if (!i || i === "unknown") return true;
  if (i === "127.0.0.1" || i === "::1") return true;
  if (i.startsWith("192.168.") || i.startsWith("10.")) return true;
  if (i.startsWith("172.")) {
    const p = i.split(".").map(Number);
    if (p.length >= 2 && p[1] !== undefined && p[1] >= 16 && p[1] <= 31) return true;
  }
  return false;
}

export function locationFromIp(ip: string): string {
  if (isPrivateOrLocal(ip)) return "Local / private network";
  try {
    const g = geoip.lookup(ip);
    if (!g) return "Unknown";
    const parts: string[] = [];
    if (g.city) parts.push(g.city);
    if (g.region && g.region !== g.city) parts.push(g.region);
    if (g.country) parts.push(g.country);
    return parts.length ? parts.join(", ") : "Unknown";
  } catch {
    return "Unknown";
  }
}
