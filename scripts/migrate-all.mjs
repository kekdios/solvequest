#!/usr/bin/env node
/**
 * Runs all idempotent SQLite migrations in order (legacy → current schema).
 * Usage: node scripts/migrate-all.mjs [path/to/solvequest.db]
 * Env: SOLVEQUEST_DB_PATH overrides default data/solvequest.db
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outPath =
  process.argv[2]?.trim() ||
  process.env.SOLVEQUEST_DB_PATH?.trim() ||
  path.join(root, "data", "solvequest.db");

if (!fs.existsSync(outPath)) {
  console.error(`[migrate-all] No database at ${outPath} — run: npm run db:init`);
  process.exit(1);
}

const steps = [
  "migrate-add-email-to-accounts.mjs",
  "migrate-tier-column.mjs",
  "migrate-receive-addresses.mjs",
  "migrate-account-sync-state.mjs",
  "migrate-deposit-worker.mjs",
  "migrate-vault-interest.mjs",
  "migrate-perp-close-unique.mjs",
  "migrate-account-custodial-deposit.mjs",
];

console.log(`[migrate-all] database: ${outPath}\n`);

for (const name of steps) {
  const script = path.join(__dirname, name);
  if (!fs.existsSync(script)) {
    console.error(`[migrate-all] missing script: ${script}`);
    process.exit(1);
  }
  console.log(`[migrate-all] → ${name}`);
  const r = spawnSync(process.execPath, [script, outPath], {
    stdio: "inherit",
    cwd: root,
  });
  if (r.status !== 0) {
    console.error(`[migrate-all] failed: ${name} (exit ${r.status ?? "unknown"})`);
    process.exit(r.status ?? 1);
  }
}

console.log("\n[migrate-all] done.");
