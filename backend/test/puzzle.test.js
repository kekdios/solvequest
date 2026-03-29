import { test } from "node:test"
import assert from "node:assert/strict"
import { hashMnemonic, normalizePhrase } from "../puzzle.js"

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
