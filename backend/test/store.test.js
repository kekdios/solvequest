import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import {
  initStore,
  closeStore,
  recordLeaderboardAttempt,
  getLeaderboardScore,
  getLeaderboardRank1Based,
  getLeaderboard,
  consumeBatchCredits,
  CREDITS_SCALE_UNITS,
} from "../store.js"

before(async () => {
  await initStore()
})

after(async () => {
  await closeStore()
})

test("CREDITS_SCALE_UNITS is positive integer", () => {
  assert.ok(Number.isInteger(CREDITS_SCALE_UNITS))
  assert.ok(CREDITS_SCALE_UNITS >= 1)
})

test("getLeaderboardRank1Based order", async () => {
  await recordLeaderboardAttempt("rank_a")
  await recordLeaderboardAttempt("rank_b")
  await recordLeaderboardAttempt("rank_b")
  assert.equal(await getLeaderboardRank1Based("rank_b"), 1)
  assert.equal(await getLeaderboardRank1Based("rank_a"), 2)
})

test("leaderboard rate limit per wallet per second", async () => {
  const w = "rate_test_wallet"
  let successes = 0
  for (let i = 0; i < 25; i++) {
    const ok = await recordLeaderboardAttempt(w)
    if (ok) successes++
  }
  const max = Number(process.env.LEADERBOARD_MAX_INCR_PER_SEC) || 20
  assert.equal(successes, max)
  assert.equal(await getLeaderboardScore(w), max)
})

test("getLeaderboard returns top array", async () => {
  const rows = await getLeaderboard(5)
  assert.ok(Array.isArray(rows))
  assert.ok(rows.length >= 1)
  assert.ok("pubkey" in rows[0])
  assert.ok("score" in rows[0])
})

test("consumeBatchCredits debits micro-units in memory", async () => {
  const r = await consumeBatchCredits("sk_test_fixture", 1000)
  assert.equal(r.ok, true)
  const r2 = await consumeBatchCredits("sk_test_fixture", 999_000_000)
  assert.equal(r2.ok, false)
  assert.equal(r2.error, "insufficient_credits")
})
