#!/usr/bin/env node
/**
 * Puzzle vault CLI (SQLite). Load backend/.env from repo root.
 *
 * Usage (from repo root):
 *   node scripts/vault-init.mjs migrate
 *   node scripts/vault-init.mjs status
 *   node scripts/vault-init.mjs bootstrap-from-env
 *   node scripts/vault-init.mjs bootstrap-from-env --force
 *
 * Requires PUZZLE_SOURCE=sqlite and SQLITE_PATH (see backend/.env.example). QUEST_* optional until funding/signing uses them.
 */

import path from "node:path"
import { fileURLToPath } from "node:url"
import { pathToFileURL } from "node:url"
import { createRequire } from "node:module"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
const backendRoot = path.join(repoRoot, "backend")

const require = createRequire(path.join(backendRoot, "package.json"))
require("dotenv").config({ path: path.join(backendRoot, ".env") })

async function loadBackend(spec) {
  return import(pathToFileURL(path.join(backendRoot, spec)).href)
}

const {
  parsePuzzleSource,
  PUZZLE_SOURCE_SQLITE,
  requireSqliteStorageEnv,
  puzzleVaultEnvSummary,
} = await loadBackend("puzzle-vault-env.js")
const {
  openPuzzleVaultDatabase,
  getActiveUnsolvedPuzzle,
  insertBootstrapPuzzleFromEnv,
} = await loadBackend("puzzle-vault-db.js")

const [, , cmd, ...rest] = process.argv
const force = rest.includes("--force")

function needSqlite() {
  if (parsePuzzleSource() !== PUZZLE_SOURCE_SQLITE) {
    console.error("Set PUZZLE_SOURCE=sqlite in backend/.env and configure vault variables.")
    process.exit(1)
  }
}

async function cmdMigrate() {
  needSqlite()
  console.log("Vault env summary:", JSON.stringify(puzzleVaultEnvSummary(), null, 2))
  const h = openPuzzleVaultDatabase()
  if (!h) {
    console.error("openPuzzleVaultDatabase returned null")
    process.exit(1)
  }
  h.db.close()
  console.log("migrate: OK (schema ready at", requireSqliteStorageEnv().sqlitePath + ")")
}

async function cmdStatus() {
  needSqlite()
  const h = openPuzzleVaultDatabase()
  if (!h) process.exit(1)
  try {
    const n = h.db.prepare(`SELECT COUNT(*) AS c FROM puzzles`).get().c
    const active = getActiveUnsolvedPuzzle(h.db)
    console.log(JSON.stringify({ total_rows: n, active_unsolved: active || null }, null, 2))
  } finally {
    h.db.close()
  }
}

async function cmdBootstrapFromEnv() {
  needSqlite()
  const h = openPuzzleVaultDatabase()
  if (!h) process.exit(1)
  try {
    const id = insertBootstrapPuzzleFromEnv(h.db, h.vault, { force })
    console.log("bootstrap-from-env: inserted puzzle id", id)
  } finally {
    h.db.close()
  }
}

const commands = {
  migrate: cmdMigrate,
  status: cmdStatus,
  "bootstrap-from-env": cmdBootstrapFromEnv,
}

if (!cmd || !commands[cmd]) {
  console.error(`Usage: node scripts/vault-init.mjs <${Object.keys(commands).join("|")}>`)
  process.exit(1)
}

await commands[cmd]().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
