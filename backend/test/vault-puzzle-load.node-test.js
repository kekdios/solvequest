import { test, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import {
  openPuzzleVaultDatabase,
  getActiveUnsolvedPuzzle,
} from "../puzzle-vault-db.js"
import { PUZZLE, applyPuzzleRowFromVault } from "../puzzle.js"

after(() => {
  const root = process.env._VAULT_PUZZLE_TEST_ROOT
  if (root) {
    try {
      fs.rmSync(root, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

test("applyPuzzleRowFromVault fills PUZZLE from vault row", () => {
  const h = openPuzzleVaultDatabase()
  assert.ok(h)
  h.db
    .prepare(
      `INSERT INTO puzzles (public_id, status, target_address, solution_hash, puzzle_words_csv)
       VALUES (?,?,?,?,?)`
    )
    .run(
      "pv-001",
      "unsolved",
      "6h4oTiusvVchVP67bjTLmuCxGjyPo2fSNTR1Pq4nwwGy",
      "abc123hash",
      "estate,refuse,glad,rare,only,faith,maximum,wide,army,hub,rent,wisdom"
    )
  const row = getActiveUnsolvedPuzzle(h.db)
  assert.ok(row)
  applyPuzzleRowFromVault(row)
  assert.equal(PUZZLE.id, "pv-001")
  assert.equal(PUZZLE.words.length, 12)
  assert.equal(PUZZLE.target_address, "6h4oTiusvVchVP67bjTLmuCxGjyPo2fSNTR1Pq4nwwGy")
  h.db.close()
})
