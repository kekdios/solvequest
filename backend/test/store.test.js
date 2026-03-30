import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import {
  initStore,
  closeStore,
  recordLeaderboardAttempt,
  recordLeaderboardWin,
  getLeaderboardScore,
  getLeaderboardRank1Based,
  getLeaderboard,
  recordVisitor,
  listVisitors,
} from "../store.js"

before(async () => {
  await initStore()
})

after(async () => {
  await closeStore()
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

test("recordLeaderboardWin dominates near-miss score", async () => {
  const w = "win_test_wallet"
  await recordLeaderboardAttempt(w)
  await recordLeaderboardWin(w)
  const s = await getLeaderboardScore(w)
  assert.ok(s >= 100_000)
  assert.equal(await getLeaderboardRank1Based(w), 1)
})

test("recordVisitor and listVisitors (in-memory)", async () => {
  await recordVisitor({ ts: 1, ip: "203.0.113.1", path: "/", country: "ZZ" })
  await recordVisitor({ ts: 2, ip: "203.0.113.2", path: "/developers" })
  const { visitors, total } = await listVisitors({ limit: 10, offset: 0 })
  assert.equal(total, 2)
  assert.equal(visitors.length, 2)
  assert.equal(visitors[0].ip, "203.0.113.2")
  assert.equal(visitors[1].country, "ZZ")
})

