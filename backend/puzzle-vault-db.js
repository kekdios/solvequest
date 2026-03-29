/**
 * SQLite vault: before opening an *existing* non-empty DB file, copy it to the backup dir (pruned).
 * Migrations use IF NOT EXISTS only — never replace the file with a blank DB.
 */

import fs from "node:fs"
import Database from "better-sqlite3"
import {
  parsePuzzleSource,
  requireSqliteStorageEnv,
  PUZZLE_SOURCE_SQLITE,
} from "./puzzle-vault-env.js"
import { backupSqliteBeforeChange } from "./puzzle-vault-backup.js"

/**
 * Call immediately before any vault write that mutates puzzle rows (insert/update/delete),
 * if the DB file already exists and is non-empty.
 * @param {ReturnType<typeof requireSqliteStorageEnv>} vault
 */
export function backupPuzzleVaultBeforeWrite(vault) {
  return backupSqliteBeforeChange(vault.sqlitePath, {
    backupDir: vault.backupDir,
    keep: vault.backupKeep,
  })
}

function tableColumnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name)
}

function ensureVaultColumns(db) {
  const cols = new Set(tableColumnNames(db, "puzzles"))
  if (!cols.has("puzzle_words_csv")) {
    db.exec("ALTER TABLE puzzles ADD COLUMN puzzle_words_csv TEXT")
  }
  if (!cols.has("difficulty")) {
    db.exec("ALTER TABLE puzzles ADD COLUMN difficulty TEXT")
  }
}

export function runVaultMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS puzzles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('unsolved', 'solved', 'claimed')),
      target_address TEXT NOT NULL,
      solution_hash TEXT NOT NULL,
      ciphertext BLOB,
      cipher_nonce BLOB,
      constraints_json TEXT,
      puzzle_words_csv TEXT,
      difficulty TEXT,
      winner_id TEXT,
      solved_at TEXT,
      claimed_at TEXT,
      quest_fund_tx TEXT,
      round_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_puzzles_public_id ON puzzles (public_id);
    CREATE INDEX IF NOT EXISTS idx_puzzles_status ON puzzles (status);
  `)
  ensureVaultColumns(db)
}

/** Latest unsolved puzzle row (highest id). */
export function getActiveUnsolvedPuzzle(db) {
  return db
    .prepare(
      `SELECT * FROM puzzles WHERE status = 'unsolved' ORDER BY id DESC LIMIT 1`
    )
    .get()
}

/**
 * Insert one unsolved puzzle from env (TARGET_ADDRESS, SOLUTION_HASH, PUZZLE_WORDS, etc.).
 * Backs up DB first when the file already has content.
 * @returns {number} inserted row id
 */
export function insertBootstrapPuzzleFromEnv(db, vault, { force = false } = {}) {
  const existing = getActiveUnsolvedPuzzle(db)
  if (existing && !force) {
    throw new Error(
      "Vault already has an unsolved puzzle. Finish or remove it, or pass --force (dangerous if two unsolved)."
    )
  }
  const target_address = process.env.TARGET_ADDRESS?.trim()
  const solution_hash = process.env.SOLUTION_HASH?.trim()
  const wordsRaw = process.env.PUZZLE_WORDS?.trim()
  if (!target_address || !solution_hash || !wordsRaw) {
    throw new Error(
      "bootstrap-from-env requires TARGET_ADDRESS, SOLUTION_HASH, PUZZLE_WORDS in environment"
    )
  }
  const words = wordsRaw
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
  if (words.length !== 12) {
    throw new Error("PUZZLE_WORDS must be exactly 12 comma-separated words")
  }
  const public_id = process.env.PUZZLE_ID?.trim() || "001"
  const round_id = process.env.ROUND_ID?.trim() || "default"
  const constraints_json = process.env.PUZZLE_CONSTRAINTS_JSON?.trim() || null
  const difficulty = process.env.PUZZLE_DIFFICULTY?.trim().toLowerCase() || null

  backupPuzzleVaultBeforeWrite(vault)
  const normalizedWordCsv = words.join(",")
  const info = db
    .prepare(
      `INSERT INTO puzzles (
        public_id, status, target_address, solution_hash, puzzle_words_csv,
        constraints_json, round_id, difficulty
      ) VALUES (?, 'unsolved', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      public_id,
      target_address,
      solution_hash,
      normalizedWordCsv,
      constraints_json,
      round_id,
      difficulty
    )
  return Number(info.lastInsertRowid)
}

/**
 * When PUZZLE_SOURCE is not sqlite, returns null.
 * Otherwise backs up existing non-empty DB, opens/creates file, runs idempotent migrations.
 * @returns {{ db: import("better-sqlite3").Database, vault: ReturnType<typeof requireSqliteStorageEnv> } | null}
 */
export function openPuzzleVaultDatabase() {
  if (parsePuzzleSource() !== PUZZLE_SOURCE_SQLITE) {
    return null
  }
  const vault = requireSqliteStorageEnv()
  const p = vault.sqlitePath
  try {
    const st = fs.statSync(p)
    if (st.isFile() && st.size > 0) {
      backupSqliteBeforeChange(p, {
        backupDir: vault.backupDir,
        keep: vault.backupKeep,
      })
    }
  } catch (e) {
    if (e && e.code === "ENOENT") {
      /* first boot — no backup */
    } else {
      throw e
    }
  }
  const db = new Database(vault.sqlitePath)
  db.pragma("journal_mode = WAL")
  runVaultMigrations(db)
  return { db, vault }
}
