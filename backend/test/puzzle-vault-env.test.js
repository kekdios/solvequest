import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import {
  parsePuzzleSource,
  parseSqliteBackupKeep,
  resolveSqliteBackupDir,
  requireSqliteVaultEnv,
  PUZZLE_SOURCE_ENV,
  PUZZLE_SOURCE_SQLITE,
} from "../puzzle-vault-env.js"

const saved = {}

function saveEnv(keys) {
  for (const k of keys) {
    saved[k] = process.env[k]
  }
}

function restoreEnv(keys) {
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
}

const keys = [
  "PUZZLE_SOURCE",
  "SQLITE_PATH",
  "SQLITE_BACKUP_DIR",
  "SQLITE_BACKUP_KEEP",
  "QUEST_OPERATOR_SECRET_KEY",
  "QUEST_MINT",
  "QUEST_FUND_AMOUNT_RAW",
  "ENCRYPTION_HKDF_SALT_HEX",
]

beforeEach(() => saveEnv(keys))
afterEach(() => restoreEnv(keys))

test("parsePuzzleSource defaults to env", () => {
  delete process.env.PUZZLE_SOURCE
  assert.equal(parsePuzzleSource(), PUZZLE_SOURCE_ENV)
  process.env.PUZZLE_SOURCE = "ENV"
  assert.equal(parsePuzzleSource(), PUZZLE_SOURCE_ENV)
})

test("parsePuzzleSource accepts sqlite", () => {
  process.env.PUZZLE_SOURCE = "sqlite"
  assert.equal(parsePuzzleSource(), PUZZLE_SOURCE_SQLITE)
})

test("parsePuzzleSource rejects invalid", () => {
  process.env.PUZZLE_SOURCE = "postgres"
  assert.throws(() => parsePuzzleSource(), /PUZZLE_SOURCE/)
})

test("parseSqliteBackupKeep default and clamp", () => {
  delete process.env.SQLITE_BACKUP_KEEP
  assert.equal(parseSqliteBackupKeep(), 7)
  process.env.SQLITE_BACKUP_KEEP = "3"
  assert.equal(parseSqliteBackupKeep(), 3)
  process.env.SQLITE_BACKUP_KEEP = "999"
  assert.equal(parseSqliteBackupKeep(), 50)
  process.env.SQLITE_BACKUP_KEEP = "0"
  assert.equal(parseSqliteBackupKeep(), 1)
})

test("resolveSqliteBackupDir explicit vs default", () => {
  delete process.env.SQLITE_BACKUP_DIR
  const base = path.resolve("/data/quests/puzzles.db")
  const derived = resolveSqliteBackupDir(base)
  assert.equal(derived, path.join(path.dirname(base), "puzzle-vault-backups"))
  process.env.SQLITE_BACKUP_DIR = "/var/backups/sq"
  assert.equal(resolveSqliteBackupDir(base), path.resolve("/var/backups/sq"))
})

test("requireSqliteVaultEnv throws when sqlite but incomplete", () => {
  process.env.PUZZLE_SOURCE = "sqlite"
  delete process.env.SQLITE_PATH
  assert.throws(() => requireSqliteVaultEnv(), /SQLITE_PATH/)
  process.env.SQLITE_PATH = "/tmp/x.db"
  assert.throws(() => requireSqliteVaultEnv(), /QUEST_OPERATOR_SECRET_KEY/)
  process.env.QUEST_OPERATOR_SECRET_KEY = "dummy"
  assert.throws(() => requireSqliteVaultEnv(), /QUEST_MINT/)
  process.env.QUEST_MINT = "So11111111111111111111111111111111111111112"
  assert.throws(() => requireSqliteVaultEnv(), /QUEST_FUND_AMOUNT_RAW/)
})

test("requireSqliteVaultEnv succeeds with full sqlite set", () => {
  process.env.PUZZLE_SOURCE = "sqlite"
  process.env.SQLITE_PATH = "/tmp/solvequest-vault.db"
  process.env.QUEST_OPERATOR_SECRET_KEY = "5J..."
  process.env.QUEST_MINT = "So11111111111111111111111111111111111111112"
  process.env.QUEST_FUND_AMOUNT_RAW = "1000000"
  delete process.env.SQLITE_BACKUP_DIR
  delete process.env.ENCRYPTION_HKDF_SALT_HEX
  const v = requireSqliteVaultEnv()
  assert.equal(v.questFundAmountRaw, "1000000")
  assert.ok(v.backupDir.includes("puzzle-vault-backups"))
  assert.equal(v.hkdfSaltHex, null)
})

test("requireSqliteVaultEnv validates HKDF salt when set", () => {
  process.env.PUZZLE_SOURCE = "sqlite"
  process.env.SQLITE_PATH = "/tmp/x.db"
  process.env.QUEST_OPERATOR_SECRET_KEY = "k"
  process.env.QUEST_MINT = "So11111111111111111111111111111111111111112"
  process.env.QUEST_FUND_AMOUNT_RAW = "1"
  process.env.ENCRYPTION_HKDF_SALT_HEX = "abcd"
  assert.throws(() => requireSqliteVaultEnv(), /ENCRYPTION_HKDF_SALT_HEX/)
  process.env.ENCRYPTION_HKDF_SALT_HEX = "0123456789abcdef"
  assert.doesNotThrow(() => requireSqliteVaultEnv())
})
