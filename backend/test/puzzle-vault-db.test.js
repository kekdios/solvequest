import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import {
  openPuzzleVaultDatabase,
  retireAllUnsolvedPuzzles,
  insertUnsolvedPuzzleRow,
  getActiveUnsolvedPuzzle,
  listRecentPuzzles,
} from "../puzzle-vault-db.js"

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
const saved = {}
let lastDb = null

beforeEach(() => {
  for (const k of keys) saved[k] = process.env[k]
})
afterEach(() => {
  if (lastDb) {
    try {
      lastDb.close()
    } catch {
      /* ignore */
    }
    lastDb = null
  }
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

test("openPuzzleVaultDatabase returns null when PUZZLE_SOURCE=env", () => {
  delete process.env.PUZZLE_SOURCE
  assert.equal(openPuzzleVaultDatabase(), null)
})

test("openPuzzleVaultDatabase works without QUEST_* (storage env only)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pv-db-nq-"))
  const dbfile = path.join(root, "vault.db")
  process.env.PUZZLE_SOURCE = "sqlite"
  process.env.SQLITE_PATH = dbfile
  process.env.SQLITE_BACKUP_KEEP = "7"
  delete process.env.QUEST_OPERATOR_SECRET_KEY
  delete process.env.QUEST_MINT
  delete process.env.QUEST_FUND_AMOUNT_RAW
  delete process.env.ENCRYPTION_HKDF_SALT_HEX

  const h = openPuzzleVaultDatabase()
  assert.ok(h)
  lastDb = h.db
  const n = h.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='puzzles'`).get()
  assert.ok(n)
  h.db.close()
  lastDb = null
})

test("openPuzzleVaultDatabase creates DB and preserves rows across reopen", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pv-db-"))
  const dbfile = path.join(root, "vault.db")
  process.env.PUZZLE_SOURCE = "sqlite"
  process.env.SQLITE_PATH = dbfile
  process.env.SQLITE_BACKUP_DIR = path.join(root, "backups")
  process.env.SQLITE_BACKUP_KEEP = "7"
  process.env.QUEST_OPERATOR_SECRET_KEY = "5J..."
  process.env.QUEST_MINT = "So11111111111111111111111111111111111111112"
  process.env.QUEST_FUND_AMOUNT_RAW = "1"
  delete process.env.ENCRYPTION_HKDF_SALT_HEX

  const first = openPuzzleVaultDatabase()
  assert.ok(first)
  lastDb = first.db
  first.db
    .prepare(
      `INSERT INTO puzzles (public_id, status, target_address, solution_hash, puzzle_words_csv) VALUES (?,?,?,?,?)`
    )
    .run(
      "p001",
      "unsolved",
      "Addr1",
      "hash1",
      "a,b,c,d,e,f,g,h,i,j,k,l"
    )
  const n1 = first.db.prepare(`SELECT COUNT(*) AS c FROM puzzles`).get().c
  assert.equal(n1, 1)
  first.db.close()
  lastDb = null

  const second = openPuzzleVaultDatabase()
  assert.ok(second)
  lastDb = second.db
  const n2 = second.db.prepare(`SELECT COUNT(*) AS c FROM puzzles`).get().c
  assert.equal(n2, 1)
  const backups = fs.readdirSync(process.env.SQLITE_BACKUP_DIR).filter((f) => f.endsWith(".db"))
  assert.ok(backups.length >= 1, "should have at least one backup after second open")
})

test("retireAllUnsolvedPuzzles then insertUnsolvedPuzzleRow", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pv-rot-"))
  const dbfile = path.join(root, "vault.db")
  process.env.PUZZLE_SOURCE = "sqlite"
  process.env.SQLITE_PATH = dbfile
  process.env.SQLITE_BACKUP_KEEP = "7"
  delete process.env.QUEST_OPERATOR_SECRET_KEY
  delete process.env.QUEST_MINT
  delete process.env.QUEST_FUND_AMOUNT_RAW

  const h = openPuzzleVaultDatabase()
  assert.ok(h)
  lastDb = h.db
  const hash64 = "a".repeat(64)
  h.db
    .prepare(
      `INSERT INTO puzzles (public_id, status, target_address, solution_hash, puzzle_words_csv) VALUES (?,?,?,?,?)`
    )
    .run("p001", "unsolved", "T1", hash64, "a,b,c,d,e,f,g,h,i,j,k,l")

  const n = retireAllUnsolvedPuzzles(h.db, h.vault)
  assert.equal(n, 1)
  const old = h.db.prepare(`SELECT status, winner_id FROM puzzles WHERE public_id = 'p001'`).get()
  assert.equal(old.status, "solved")
  assert.equal(old.winner_id, "operator_retired")

  const rowId = insertUnsolvedPuzzleRow(h.db, h.vault, {
    public_id: "p002",
    target_address: "T2",
    solution_hash: hash64,
    puzzle_words_csv: "z,y,x,w,v,u,t,s,r,q,p,o",
    difficulty: null,
  })
  assert.ok(rowId > 0)
  const active = getActiveUnsolvedPuzzle(h.db)
  assert.equal(active.public_id, "p002")
  assert.equal(active.target_address, "T2")

  assert.throws(
    () =>
      insertUnsolvedPuzzleRow(h.db, h.vault, {
        public_id: "p002",
        target_address: "T3",
        solution_hash: hash64,
        puzzle_words_csv: "a,b,c,d,e,f,g,h,i,j,k,l",
        difficulty: null,
      }),
    /public_id already/
  )
})

test("listRecentPuzzles orders by id desc and caps limit", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pv-list-"))
  const dbfile = path.join(root, "vault.db")
  process.env.PUZZLE_SOURCE = "sqlite"
  process.env.SQLITE_PATH = dbfile
  process.env.SQLITE_BACKUP_KEEP = "7"
  delete process.env.QUEST_OPERATOR_SECRET_KEY
  delete process.env.QUEST_MINT
  delete process.env.QUEST_FUND_AMOUNT_RAW

  const h = openPuzzleVaultDatabase()
  assert.ok(h)
  lastDb = h.db
  const hash64 = "b".repeat(64)
  for (let i = 1; i <= 3; i++) {
    h.db
      .prepare(
        `INSERT INTO puzzles (public_id, status, target_address, solution_hash, puzzle_words_csv) VALUES (?,?,?,?,?)`
      )
      .run(`px${i}`, "unsolved", `T${i}`, hash64, "a,b,c,d,e,f,g,h,i,j,k,l")
  }
  const recent = listRecentPuzzles(h.db, 2)
  assert.equal(recent.length, 2)
  assert.equal(recent[0].public_id, "px3")
  assert.equal(recent[1].public_id, "px2")
  assert.ok(!("puzzle_words_csv" in recent[0]))
  assert.ok(!("ciphertext" in recent[0]))
})
