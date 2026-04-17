#!/usr/bin/env npx tsx
/**
 * One-shot USDC deposit scan (same as admin “Run USDC deposit scanner”).
 * Loads `.env` from repo root; if `SOLVEQUEST_DB_PATH` points at a missing file, uses `data/solvequest.db`.
 *
 * Usage: from repo root, `npx tsx scripts/test-deposit-scan-once.ts`
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../server/loadEnv";
import { rpcUrl, runQusdBuyScanOnce } from "../server/qusdBuyScanWorker";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const configured = process.env.SOLVEQUEST_DB_PATH?.trim();
if (configured && !fs.existsSync(configured)) {
  const local = path.join(root, "data", "solvequest.db");
  console.warn(`[test-deposit-scan] SOLVEQUEST_DB_PATH not found (${configured}) — using ${local}`);
  process.env.SOLVEQUEST_DB_PATH = local;
}

function rpcHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "(invalid URL)";
  }
}

const url = rpcUrl(process.env);
console.log("[test-deposit-scan] RPC host:", rpcHost(url));
console.log("[test-deposit-scan] DB:", process.env.SOLVEQUEST_DB_PATH ?? path.join(root, "data", "solvequest.db"));

void runQusdBuyScanOnce(root, process.env, { verbose: true }).then((r) => {
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
});
