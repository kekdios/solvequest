import { test } from "node:test"
import assert from "node:assert/strict"
import {
  parseSolveMessage,
  hashMnemonic,
  normalizePhrase,
  PUZZLE,
} from "../puzzle.js"

test("normalizePhrase trims and lowercases", () => {
  assert.equal(normalizePhrase("  Foo   BAR "), "foo bar")
})

test("hashMnemonic is stable hex sha256", () => {
  const a = hashMnemonic("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about")
  assert.match(a, /^[0-9a-f]{64}$/)
  assert.equal(
    a,
    hashMnemonic("  abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about  ")
  )
})

test("parseSolveMessage 5-part binding", () => {
  const h = "a".repeat(64)
  const m = `solve:${PUZZLE.id}:1700000000:nonce1:${h}`
  const p = parseSolveMessage(m, PUZZLE.id, false, false, false, false)
  assert.ok(p)
  assert.equal(p.mode, "timestamp_nonce_binding")
  assert.equal(p.mnemonicHash, h)
})

test("parseSolveMessage 6-part includes roundId", () => {
  const h = "b".repeat(64)
  const m = `solve:r-alpha:${PUZZLE.id}:1700000000:n1:${h}`
  const p = parseSolveMessage(m, PUZZLE.id, false, false, false, false)
  assert.ok(p)
  assert.equal(p.roundId, "r-alpha")
})

test("parseSolveMessage requireRoundInMessage rejects 5-part", () => {
  const h = "c".repeat(64)
  const m = `solve:${PUZZLE.id}:1700000000:n1:${h}`
  const p = parseSolveMessage(m, PUZZLE.id, false, false, false, true)
  assert.equal(p, null)
})

test("parseSolveMessage wrong puzzle id", () => {
  const h = "d".repeat(64)
  const m = `solve:wrong:1700000000:n1:${h}`
  const p = parseSolveMessage(m, PUZZLE.id, false, false, false, false)
  assert.equal(p, null)
})
