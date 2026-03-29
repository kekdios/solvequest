import { test, afterEach } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { backupSqliteBeforeChange, pruneOldBackups } from "../puzzle-vault-backup.js"

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

test("backupSqliteBeforeChange skips when DB missing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pv-bak-"))
  try {
    const db = path.join(root, "nope.db")
    const r = backupSqliteBeforeChange(db, { backupDir: path.join(root, "bak"), keep: 7 })
    assert.equal(r.skipped, true)
    assert.equal(r.reason, "db_not_found_yet")
  } finally {
    rmrf(root)
  }
})

test("backupSqliteBeforeChange skips empty file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pv-bak-"))
  try {
    const db = path.join(root, "vault.db")
    fs.writeFileSync(db, "", "utf8")
    const r = backupSqliteBeforeChange(db, { backupDir: path.join(root, "bak"), keep: 7 })
    assert.equal(r.skipped, true)
    assert.equal(r.reason, "db_missing_or_empty")
  } finally {
    rmrf(root)
  }
})

test("backupSqliteBeforeChange copies and prune keeps newest", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pv-bak-"))
  try {
    const db = path.join(root, "vault.db")
    const bak = path.join(root, "puzzle-vault-backups")
    fs.writeFileSync(db, "sqlite-header-v1", "utf8")

    const r1 = backupSqliteBeforeChange(db, { backupDir: bak, keep: 7 })
    assert.equal(r1.skipped, false)
    assert.ok(r1.copiedTo?.includes("vault-"))

    fs.writeFileSync(db, "sqlite-header-v2", "utf8")
    const r2 = backupSqliteBeforeChange(db, { backupDir: bak, keep: 7 })
    assert.equal(r2.skipped, false)

    const copies = fs.readdirSync(bak).filter((f) => f.startsWith("vault-") && f.endsWith(".db"))
    assert.equal(copies.length, 2)
    assert.equal(fs.readFileSync(db, "utf8"), "sqlite-header-v2")
  } finally {
    rmrf(root)
  }
})

test("pruneOldBackups removes beyond keep", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pv-prune-"))
  try {
    const bak = path.join(root, "bak")
    fs.mkdirSync(bak, { recursive: true })
    const base = "vault"
    for (let i = 0; i < 5; i++) {
      const f = path.join(bak, `${base}-old${i}.db`)
      fs.writeFileSync(f, "x", "utf8")
      const t = Date.now() - (5 - i) * 1000
      fs.utimesSync(f, t / 1000, t / 1000)
    }
    pruneOldBackups(bak, base, 2)
    const left = fs.readdirSync(bak).filter((f) => f.endsWith(".db"))
    assert.equal(left.length, 2)
  } finally {
    rmrf(root)
  }
})
