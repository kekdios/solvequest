import crypto from "crypto"
import { createClient } from "redis"

let redis = null
let redisSubscriber = null
let memory = null

const STATS_KEY = "stats:global"
const PUZZLE_WINNER_KEY = "puzzle:winner"
const ARENA_START_KEY = "arena:start_time"
/** @deprecated legacy hash; new scores use LEADERBOARD_ZSET */
const LEADERBOARD_HASH = "stats:wallet"
const LEADERBOARD_ZSET = "leaderboard:global"
const CLAIM_LOCK_KEY = "puzzle:claim_lock"
const CHANNEL_EVENTS = "arena:events"
const ROUND_END_MS_KEY = "puzzle:round_end_ms"
const ROUND_ID_STORE_KEY = "puzzle:round_id"
const ROUND_SETTLED_KEY = "puzzle:round_settled"
const ROUND_LEADERBOARD_WINNER_KEY = "puzzle:round_leaderboard_winner"
const ROUND_SETTLE_LOCK_KEY = "puzzle:round_settle_lock"

const LEADERBOARD_MAX_INCR_PER_SEC = Math.min(
  Math.max(Number(process.env.LEADERBOARD_MAX_INCR_PER_SEC) || 20, 1),
  500
)

/** 1 display credit = CREDITS_SCALE_UNITS integer (default 1000). */
export const CREDITS_SCALE_UNITS = Math.max(
  1,
  Math.floor(Number(process.env.CREDITS_SCALE_UNITS) || 1000)
)

/** SET winner NX + DEL claim lock in one script */
const LUA_WIN_AND_RELEASE_LOCK = `
local ok = redis.call('SET', KEYS[1], ARGV[1], 'NX')
if not ok then return 0 end
redis.call('DEL', KEYS[2])
return 1
`

/** Atomic credit deduction (integer micro-units); returns 1 ok, -1 insufficient, -2 missing key */
const LUA_DEDUCT_CREDITS = `
local key = KEYS[1]
local cost = tonumber(ARGV[1])
if not cost or cost < 0 then return redis.error_reply('BAD') end
local micro = redis.call('HGET', key, 'credits_micro')
if not micro then
  local legacy = redis.call('HGET', key, 'credits')
  if not legacy then return -2 end
  micro = tostring(math.floor(tonumber(legacy) * 1000))
  redis.call('HSET', key, 'credits_micro', micro)
end
local c = tonumber(micro)
if not c or c < cost then return -1 end
redis.call('HINCRBY', key, 'credits_micro', -cost)
return 1
`

function mem() {
  if (!memory) {
    memory = {
      startMs: Date.now(),
      stats: {
        validations_single: 0,
        batch_items: 0,
        submits: 0,
        claims: 0,
        valid_checksums: 0,
        constraint_rejects: 0,
        invalid_mnemonics: 0,
        valid_target_misses: 0,
        address_mismatches: 0,
        attempts_after_constraints: 0,
        attempts_valid_checksum: 0,
      },
      winner: null,
      leaderboardZ: {},
      roundEndMs: null,
      roundId: null,
      claimLock: false,
      claimResults: {},
      apiKeys: {},
      roundSettledFor: null,
      roundEndEventSentFor: null,
      roundLeaderboardWinner: null,
      lbRate: {},
    }
  }
  return memory
}

export async function initStore(options = {}) {
  const url = process.env.REDIS_URL?.trim()
  if (url) {
    redis = createClient({ url })
    redis.on("error", (err) => console.error("[redis]", err))
    await redis.connect()
    await redis.set(ARENA_START_KEY, String(Date.now()), { NX: true })
    const rid = process.env.ROUND_ID?.trim() || "default"
    await redis.set(ROUND_ID_STORE_KEY, rid, { NX: true })
    const dur = Number(process.env.ROUND_DURATION_SEC)
    if (Number.isFinite(dur) && dur > 0) {
      const endMs = String(Date.now() + dur * 1000)
      await redis.set(ROUND_END_MS_KEY, endMs, { NX: true })
    }
    console.log("[store] Redis connected")

    redisSubscriber = redis.duplicate()
    redisSubscriber.on("error", (err) => console.error("[redis sub]", err))
    await redisSubscriber.connect()
    await redisSubscriber.subscribe(CHANNEL_EVENTS, (msg) => {
      try {
        const ev = JSON.parse(msg)
        options.onRedisBroadcast?.(ev)
      } catch (e) {
        console.error("[redis sub] bad message", e)
      }
    })
    console.log("[store] Redis pub/sub subscribed:", CHANNEL_EVENTS)
  } else {
    console.warn(
      "[store] REDIS_URL not set — using in-memory state (dev only; not horizontal-safe)"
    )
    const m0 = mem()
    m0.roundId = process.env.ROUND_ID?.trim() || "default"
    const dur = Number(process.env.ROUND_DURATION_SEC)
    if (Number.isFinite(dur) && dur > 0) {
      m0.roundEndMs = Date.now() + dur * 1000
    }
    const raw = process.env.API_KEYS_JSON?.trim()
    if (raw) {
      try {
        const j = JSON.parse(raw)
        for (const [k, v] of Object.entries(j)) {
          const scale = CREDITS_SCALE_UNITS
          const micro =
            v.credits_micro != null
              ? Math.floor(Number(v.credits_micro))
              : Math.round(Math.max(0, Number(v.credits) || 0) * scale)
          mem().apiKeys[k] = {
            credits_micro: micro,
            tier: v.tier || "paid",
          }
        }
        console.log("[store] Loaded API_KEYS_JSON for in-memory keys")
      } catch (e) {
        console.error("[store] API_KEYS_JSON parse error", e)
      }
    }
  }
}

async function hincr(field, n = 1) {
  if (redis) {
    await redis.hIncrBy(STATS_KEY, field, n)
    return
  }
  const m = mem()
  m.stats[field] = (m.stats[field] || 0) + n
}

export async function recordSingleValidation() {
  await hincr("validations_single", 1)
}

export async function recordBatchItems(n) {
  await hincr("batch_items", n)
}

export async function recordSubmit() {
  await hincr("submits", 1)
}

export async function recordClaim() {
  await hincr("claims", 1)
}

export async function recordValidChecksum() {
  await hincr("valid_checksums", 1)
}

export async function recordConstraintReject() {
  await hincr("constraint_rejects", 1)
}

export async function recordInvalidMnemonic() {
  await hincr("invalid_mnemonics", 1)
}

export async function recordValidTargetMiss() {
  await hincr("valid_target_misses", 1)
}

export async function recordAddressMismatch() {
  await hincr("address_mismatches", 1)
}

/** Per-evaluation signal: noise vs real work. */
export async function recordGranularEval(ev) {
  if (ev.passed_constraints) {
    await hincr("attempts_after_constraints", 1)
  }
  if (ev.valid_checksum === true) {
    await hincr("attempts_valid_checksum", 1)
  }
}

export async function recordValidationOutcome(ev) {
  if (ev.rejected_by_constraints) {
    await recordConstraintReject()
  } else if (ev.valid_checksum !== true) {
    await recordInvalidMnemonic()
  } else if (!ev.matches_target) {
    await recordValidTargetMiss()
  }
}

async function getStat(field) {
  if (redis) {
    const v = await redis.hGet(STATS_KEY, field)
    return Number(v) || 0
  }
  return mem().stats[field] || 0
}

export async function getAttemptsTotal() {
  const [a, b, c, d] = await Promise.all([
    getStat("validations_single"),
    getStat("batch_items"),
    getStat("submits"),
    getStat("claims"),
  ])
  return a + b + c + d
}

export async function getValidChecksumsCount() {
  return getStat("valid_checksums")
}

export async function getArenaStartMs() {
  if (redis) {
    const s = await redis.get(ARENA_START_KEY)
    return s ? Number(s) : Date.now()
  }
  return mem().startMs
}

export async function getPuzzleState() {
  if (redis) {
    const winner = await redis.get(PUZZLE_WINNER_KEY)
    return { solved: !!winner, winner: winner || null }
  }
  const w = mem().winner
  return { solved: !!w, winner: w }
}

export async function trySetWinner(winnerId) {
  if (redis) {
    const r = await redis.set(PUZZLE_WINNER_KEY, winnerId, { NX: true })
    return r === "OK"
  }
  const m = mem()
  if (m.winner) return false
  m.winner = winnerId
  return true
}

/**
 * Atomically set winner (NX) and release claim lock — avoids stale lock after success.
 */
export async function trySetWinnerAtomic(winnerId) {
  if (redis) {
    const r = await redis.eval(LUA_WIN_AND_RELEASE_LOCK, {
      keys: [PUZZLE_WINNER_KEY, CLAIM_LOCK_KEY],
      arguments: [winnerId],
    })
    return Number(r) === 1
  }
  const m = mem()
  if (m.winner) return false
  m.winner = winnerId
  m.claimLock = false
  return true
}

const LOCK_TTL_SEC = Math.min(
  Math.max(Number(process.env.CLAIM_LOCK_TTL_SEC) || 5, 1),
  30
)

export async function acquireClaimLock() {
  if (redis) {
    const r = await redis.set(CLAIM_LOCK_KEY, "1", { NX: true, EX: LOCK_TTL_SEC })
    return r === "OK"
  }
  const m = mem()
  if (m.claimLock) return false
  m.claimLock = true
  return true
}

export async function releaseClaimLock() {
  if (redis) {
    await redis.del(CLAIM_LOCK_KEY)
    return
  }
  mem().claimLock = false
}

function claimResultKey(pubkey, mnemonicHash) {
  return `claim:result:${pubkey}:${mnemonicHash}`
}

export async function getCachedClaimResult(pubkey, mnemonicHash) {
  if (!mnemonicHash) return null
  if (redis) {
    const v = await redis.get(claimResultKey(pubkey, mnemonicHash))
    if (!v) return null
    try {
      return JSON.parse(v)
    } catch {
      return null
    }
  }
  const k = `${pubkey}:${mnemonicHash}`
  return mem().claimResults[k] ?? null
}

export async function setCachedClaimResult(pubkey, mnemonicHash, obj, ttlSec = 300) {
  if (!mnemonicHash) return
  if (redis) {
    await redis.set(claimResultKey(pubkey, mnemonicHash), JSON.stringify(obj), {
      EX: ttlSec,
    })
    return
  }
  mem().claimResults[`${pubkey}:${mnemonicHash}`] = obj
}

const MESSAGE_DEDUP_TTL_SEC = Math.min(
  Math.max(Number(process.env.SIGNED_MESSAGE_DEDUP_TTL_SEC) || 60, 10),
  600
)

/**
 * One use per exact signed message (SHA-256 of UTF-8) per pubkey — stops replay inside the time window.
 */
async function isRoundActiveInternal() {
  if (redis) {
    const endMs = await redis.get(ROUND_END_MS_KEY)
    if (!endMs) return true
    return Date.now() < Number(endMs)
  }
  const m = mem()
  if (m.roundEndMs == null) return true
  return Date.now() < m.roundEndMs
}

function roundSettleGraceMs() {
  return Math.round((Number(process.env.ROUND_SETTLE_GRACE_SEC) || 3) * 1000)
}

/** Round metadata for clients (timed arena). */
export async function getRoundState() {
  const ridEnv = process.env.ROUND_ID?.trim() || "default"
  const graceMs = roundSettleGraceMs()
  const now = Date.now()
  if (redis) {
    const [endMs, rid, settledVal] = await Promise.all([
      redis.get(ROUND_END_MS_KEY),
      redis.get(ROUND_ID_STORE_KEY),
      redis.get(ROUND_SETTLED_KEY),
    ])
    const ridCur = rid || ridEnv
    const end = endMs ? Number(endMs) : null
    const active = end == null || now < end
    const settleAt = end != null ? end + graceMs : null
    const settled = settledVal === ridCur
    const lbWinner = await redis.get(ROUND_LEADERBOARD_WINNER_KEY)
    let phase = "active"
    if (end != null) {
      if (now < end) phase = "active"
      else if (settled) phase = "settled"
      else phase = "grace"
    }
    return {
      round_id: ridCur,
      round_end_ms: end,
      round_active: active,
      round_phase: phase,
      round_settle_at_ms: settleAt,
      round_settled: settled,
      round_leaderboard_winner: lbWinner || null,
    }
  }
  const m = mem()
  const end = m.roundEndMs
  const active = end == null || now < end
  const settleAt = end != null ? end + graceMs : null
  const settled = m.roundSettledFor === m.roundId && m.roundId != null
  let phase = "active"
  if (end != null) {
    if (now < end) phase = "active"
    else if (settled) phase = "settled"
    else phase = "grace"
  }
  return {
    round_id: m.roundId || ridEnv,
    round_end_ms: end,
    round_active: active,
    round_phase: phase,
    round_settle_at_ms: settleAt,
    round_settled: settled,
    round_leaderboard_winner: m.roundLeaderboardWinner || null,
  }
}

/**
 * After round_end + grace: freeze leaderboard winner row, emit round_settled (call from 1s tick).
 */
export async function maybeSendRoundEndEvent(publishFn) {
  if (redis) {
    const endMs = await redis.get(ROUND_END_MS_KEY)
    if (!endMs || Date.now() < Number(endMs)) return
    const rid =
      (await redis.get(ROUND_ID_STORE_KEY)) || process.env.ROUND_ID?.trim() || "default"
    const ok = await redis.set(`arena:round_end_event:${rid}`, "1", {
      NX: true,
      EX: 86400,
    })
    if (ok !== "OK") return
    publishFn({ type: "round_end", round_id: rid })
    return
  }
  const m = mem()
  if (!m.roundEndMs || Date.now() < m.roundEndMs) return
  if (m.roundEndEventSentFor === m.roundId) return
  m.roundEndEventSentFor = m.roundId
  publishFn({ type: "round_end", round_id: m.roundId })
}

export async function maybeSettleRound(publishFn) {
  const graceMs = roundSettleGraceMs()
  const ridEnv = process.env.ROUND_ID?.trim() || "default"
  if (!redis) {
    const m = mem()
    if (!m.roundEndMs || !m.roundId) return
    if (Date.now() < m.roundEndMs + graceMs) return
    if (m.roundSettledFor === m.roundId) return
    m.roundSettledFor = m.roundId
    const sorted = Object.entries(m.leaderboardZ || {}).sort((a, b) => b[1] - a[1])
    const lbWinner = sorted[0]?.[0] || null
    m.roundLeaderboardWinner = lbWinner
    const puzzleWinner = m.winner || null
    publishFn({
      type: "round_settled",
      round_id: m.roundId,
      leaderboard_winner: lbWinner,
      puzzle_winner: puzzleWinner,
    })
    return
  }
  const endMs = await redis.get(ROUND_END_MS_KEY)
  if (!endMs) return
  const rid = (await redis.get(ROUND_ID_STORE_KEY)) || ridEnv
  if (Date.now() < Number(endMs) + graceMs) return
  if ((await redis.get(ROUND_SETTLED_KEY)) === rid) return
  const lock = await redis.set(ROUND_SETTLE_LOCK_KEY, "1", { NX: true, EX: 30 })
  if (lock !== "OK") return
  try {
    if ((await redis.get(ROUND_SETTLED_KEY)) === rid) return
    const top = await redis.zRangeWithScores(LEADERBOARD_ZSET, 0, 0, { REV: true })
    const lbWinner = top[0]?.value ?? null
    const puzzleWinner = await redis.get(PUZZLE_WINNER_KEY)
    await redis.set(ROUND_SETTLED_KEY, rid)
    if (lbWinner) await redis.set(ROUND_LEADERBOARD_WINNER_KEY, lbWinner)
    publishFn({
      type: "round_settled",
      round_id: rid,
      leaderboard_winner: lbWinner,
      puzzle_winner: puzzleWinner || null,
    })
  } finally {
    await redis.del(ROUND_SETTLE_LOCK_KEY)
  }
}

export async function isApiKeyValid(apiKeyHeader) {
  if (!apiKeyHeader?.trim()) return false
  const key = apiKeyHeader.trim()
  if (redis) {
    return (await redis.exists(`apikey:${key}`)) === 1
  }
  return !!mem().apiKeys[key]
}

export async function getApiKeyTier(apiKeyHeader) {
  if (!apiKeyHeader?.trim()) return "free"
  const key = apiKeyHeader.trim()
  if (redis) {
    const t = await redis.hGet(`apikey:${key}`, "tier")
    return t || "paid"
  }
  const info = mem().apiKeys[key]
  return info?.tier || "paid"
}

export async function consumeSignedMessageOnce(pubkey, message) {
  const h = crypto.createHash("sha256").update(message, "utf8").digest("hex")
  const key = `claim:msg:${pubkey}:${h}`
  if (redis) {
    const r = await redis.set(key, "1", { NX: true, EX: MESSAGE_DEDUP_TTL_SEC })
    return r === "OK"
  }
  const m = mem()
  if (!m.msgSeen) {
    m.msgSeen = new Set()
  }
  const id = key
  if (m.msgSeen.has(id)) return false
  m.msgSeen.add(id)
  if (m.msgSeen.size > 50_000) m.msgSeen.clear()
  return true
}

async function leaderboardIncrAllowed(wallet) {
  const key = wallet || "anonymous"
  if (redis) {
    const sec = Math.floor(Date.now() / 1000)
    const rk = `leaderboard:lbps:${key}:${sec}`
    const cnt = await redis.incr(rk)
    if (cnt === 1) await redis.expire(rk, 2)
    return cnt <= LEADERBOARD_MAX_INCR_PER_SEC
  }
  const m = mem()
  const sec = Math.floor(Date.now() / 1000)
  const k = `${key}:${sec}`
  m.lbRate[k] = (m.lbRate[k] || 0) + 1
  return m.lbRate[k] <= LEADERBOARD_MAX_INCR_PER_SEC
}

/**
 * +1 on leaderboard for a valid-checksum "near miss" (wrong target).
 * Frozen when the round has ended (no new points).
 * Rate-limited per wallet (LEADERBOARD_MAX_INCR_PER_SEC / sec).
 * @returns true if score changed
 */
export async function recordLeaderboardAttempt(wallet) {
  const key = wallet || "anonymous"
  if (!(await isRoundActiveInternal())) return false
  if (!(await leaderboardIncrAllowed(key))) return false
  if (redis) {
    await redis.zIncrBy(LEADERBOARD_ZSET, 1, key)
    return true
  }
  const lb = mem().leaderboardZ
  lb[key] = (lb[key] || 0) + 1
  return true
}

/** Optional anti-spam: negative delta on constraint reject (set LEADERBOARD_CONSTRAINT_PENALTY). */
export async function recordLeaderboardConstraintPenalty(wallet) {
  const delta = Number(process.env.LEADERBOARD_CONSTRAINT_PENALTY)
  if (!Number.isFinite(delta) || delta === 0) return false
  const key = wallet || "anonymous"
  if (!(await isRoundActiveInternal())) return false
  if (!(await leaderboardIncrAllowed(key))) return false
  if (redis) {
    await redis.zIncrBy(LEADERBOARD_ZSET, delta, key)
    return true
  }
  const lb = mem().leaderboardZ
  lb[key] = (lb[key] || 0) + delta
  return true
}

export async function getLeaderboardScore(pubkey) {
  const key = pubkey || "anonymous"
  if (redis) {
    const s = await redis.zScore(LEADERBOARD_ZSET, key)
    return s != null ? Number(s) : null
  }
  const v = mem().leaderboardZ[key]
  return v != null ? v : null
}

/** 1-based rank, or null if not on board */
export async function getLeaderboardRank1Based(pubkey) {
  const key = pubkey || "anonymous"
  if (redis) {
    const r = await redis.zRevRank(LEADERBOARD_ZSET, key)
    return r == null ? null : r + 1
  }
  const z = mem().leaderboardZ
  if (z[key] == null) return null
  const sorted = Object.entries(z).sort((a, b) => b[1] - a[1])
  const idx = sorted.findIndex(([k]) => k === key)
  return idx >= 0 ? idx + 1 : null
}

/** Sorted by score (valid-checksum attempts). Highest first. */
export async function getLeaderboard(limit = 20) {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 100)
  if (redis) {
    const rows = await redis.zRangeWithScores(LEADERBOARD_ZSET, 0, lim - 1, {
      REV: true,
    })
    return rows.map(({ value, score }) => ({ pubkey: value, score }))
  }
  const z = mem().leaderboardZ
  return Object.entries(z)
    .sort((a, b) => b[1] - a[1])
    .slice(0, lim)
    .map(([pubkey, score]) => ({ pubkey, score }))
}

export function isRedisEnabled() {
  return !!redis
}

export async function publishArenaEvent(event) {
  if (redis) {
    await redis.publish(CHANNEL_EVENTS, JSON.stringify(event))
  }
}

/** cost = integer micro-units (caller multiplies human credits by CREDITS_SCALE_UNITS). */
export async function consumeBatchCredits(apiKeyHeader, costMicro) {
  const c = Number(costMicro)
  if (!Number.isFinite(c) || c <= 0) return { ok: true, tier: "free" }
  if (!apiKeyHeader?.trim()) return { ok: true, tier: "free" }
  const key = apiKeyHeader.trim()
  const redisKey = `apikey:${key}`

  if (redis) {
    const r = await redis.eval(LUA_DEDUCT_CREDITS, {
      keys: [redisKey],
      arguments: [String(Math.floor(c))],
    })
    if (r === -2 || r === null) {
      return { ok: false, error: "invalid_api_key" }
    }
    if (r === -1) {
      return { ok: false, error: "insufficient_credits" }
    }
    const tier = (await redis.hGet(redisKey, "tier")) || "paid"
    return { ok: true, tier }
  }

  const m = mem()
  const info = m.apiKeys[key]
  if (!info) return { ok: false, error: "invalid_api_key" }
  let micro = Number(info.credits_micro)
  if (!Number.isFinite(micro)) {
    micro = Math.round(Math.max(0, Number(info.credits) || 0) * CREDITS_SCALE_UNITS)
    info.credits_micro = micro
  }
  if (micro < c) {
    return { ok: false, error: "insufficient_credits" }
  }
  info.credits_micro = micro - Math.floor(c)
  return { ok: true, tier: info.tier || "paid" }
}

export async function getExtendedStats() {
  const fields = [
    "constraint_rejects",
    "invalid_mnemonics",
    "valid_target_misses",
    "address_mismatches",
    "attempts_after_constraints",
    "attempts_valid_checksum",
  ]
  const out = {}
  if (redis) {
    for (const f of fields) {
      out[f] = await getStat(f)
    }
  } else {
    const m = mem().stats
    for (const f of fields) {
      out[f] = m[f] || 0
    }
  }
  return out
}

export async function closeStore() {
  if (redisSubscriber) {
    await redisSubscriber.quit().catch(() => {})
    redisSubscriber = null
  }
  if (redis) {
    await redis.quit().catch(() => {})
    redis = null
  }
}
