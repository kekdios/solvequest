/**
 * Page-view visitor tracking helpers: client IP (behind proxy) + geoip-lite lookup.
 */

import { createRequire } from "module"

const require = createRequire(import.meta.url)
const geoip = require("geoip-lite")

/** GET paths that count as a human page view (not API polling). */
const PAGE_VIEW_PATHS = new Set([
  "/",
  "/index.html",
  "/developers",
  "/developers.html",
  "/puzzle-wizard.html",
  "/visitors",
  "/visitors.html",
])

export function shouldRecordVisitorPageView(req) {
  if (req.method !== "GET") return false
  let p = req.path || ""
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1)
  return PAGE_VIEW_PATHS.has(p)
}

function normalizeIp(ip) {
  let s = String(ip ?? "").trim()
  if (s.startsWith("::ffff:")) s = s.slice(7)
  return s
}

export function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"]
  if (xff) {
    const part = String(xff).split(",")[0].trim()
    if (part) return normalizeIp(part)
  }
  const rip = req.socket?.remoteAddress
  if (rip) return normalizeIp(rip)
  if (req.ip) return normalizeIp(String(req.ip))
  return ""
}

/**
 * @returns {{ country: string|null, region: string|null, city: string|null, timezone: string|null, ll: [number, number]|null, note?: string }}
 */
export function geoForIp(ip) {
  const s = normalizeIp(ip)
  if (!s || s === "127.0.0.1" || s === "::1") {
    return {
      country: null,
      region: null,
      city: null,
      timezone: null,
      ll: null,
      note: "loopback",
    }
  }
  const g = geoip.lookup(s)
  if (!g) {
    return {
      country: null,
      region: null,
      city: null,
      timezone: null,
      ll: null,
      note: "geo_miss",
    }
  }
  return {
    country: g.country ?? null,
    region: g.region ?? null,
    city: g.city ?? null,
    timezone: g.timezone ?? null,
    ll: Array.isArray(g.ll) ? g.ll : null,
  }
}
