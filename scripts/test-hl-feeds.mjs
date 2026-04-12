/**
 * Verifies Hyperliquid price legs used by the app (allMids BTC/ETH/SOL + xyz GOLD/SILVER/CL).
 * Reads HYPERLIQUID_API_KEY and optional HYPERLIQUID_INFO_URL from .env in project root.
 *
 * Usage: node scripts/test-hl-feeds.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env");

function loadDotEnv() {
  const out = {};
  if (!existsSync(envPath)) return out;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const env = { ...process.env, ...loadDotEnv() };
const INFO_URL = (env.HYPERLIQUID_INFO_URL || "https://api.hyperliquid.xyz/info").trim();
const API_KEY = (env.HYPERLIQUID_API_KEY || "").trim();

function headers() {
  const h = { "Content-Type": "application/json" };
  if (API_KEY) h.Authorization = `Bearer ${API_KEY}`;
  return h;
}

async function post(body) {
  const res = await fetch(INFO_URL, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

function parseMid(raw) {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

let failed = false;

console.log("Hyperliquid feed check");
console.log("  INFO_URL:", INFO_URL);
console.log("  API_KEY:", API_KEY ? `set (${API_KEY.length} chars)` : "not set (public only)");

const main = await post({ type: "allMids" });
if (!main.ok || !main.data || typeof main.data !== "object") {
  console.error("FAIL allMids:", main.status, typeof main.data === "string" ? main.data.slice(0, 200) : main.data);
  failed = true;
} else {
  const mids = main.data;
  for (const coin of ["BTC", "ETH", "SOL"]) {
    const n = parseMid(mids[coin]);
    if (n === null) {
      console.error(`FAIL allMids missing/invalid ${coin}`);
      failed = true;
    } else {
      console.log(`  OK allMids ${coin}:`, n);
    }
  }
}

const xyz = await post({ type: "metaAndAssetCtxs", dex: "xyz" });
if (!xyz.ok || !Array.isArray(xyz.data) || xyz.data.length < 2) {
  console.error("FAIL metaAndAssetCtxs xyz:", xyz.status, xyz.data);
  failed = true;
} else {
  const meta = xyz.data[0];
  const ctxs = xyz.data[1];
  const names = meta.universe?.map((u) => u.name) ?? [];
  for (const hlName of ["xyz:GOLD", "xyz:SILVER", "xyz:CL"]) {
    const idx = names.indexOf(hlName);
    if (idx < 0 || idx >= ctxs.length) {
      console.error(`FAIL xyz universe missing ${hlName}`);
      failed = true;
      continue;
    }
    const n = parseMid(ctxs[idx]?.markPx);
    if (n === null) {
      console.error(`FAIL xyz markPx ${hlName}`);
      failed = true;
    } else {
      console.log(`  OK xyz ${hlName} markPx:`, n);
    }
  }
}

process.exit(failed ? 1 : 0);
