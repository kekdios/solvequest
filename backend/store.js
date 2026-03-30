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
const CHANNEL_EVENTS = "arena:events"
const PAYOUT_JOB_SEQ_KEY = "payout:job_seq"
const PAYOUT_JOB_INDEX_KEY = "payout:jobs"
const VISITORS_LOG_KEY = "visitors:log"

const LEADERBOARD_MAX_INCR_PER_SEC = Math.min(
  Math.max(Number(process.env.LEADERBOARD_MAX_INCR_PER_SEC) || 20, 1),
  500
)

/** Leaderboard points added when a wallet wins (dominates +1 near-miss increments). */
const LEADERBOARD_WIN_POINTS = Math.max(
  1,
  Math.floor(Number(process.env.LEADERBOARD_WIN_POINTS) || 100_000)
)

function mem() {
  if (!memory) {
    memory = {
      startMs: Date.now(),
      stats: {
        validations_single: 0,
        batch_items: 0,
        submits: 0,
        valid_checksums: 0,
        constraint_rejects: 0,
        invalid_mnemonics: 0,
        valid_target_misses: 0,
        attempts_after_constraints: 0,
        attempts_valid_checksum: 0,
      },
      winner: null,
      leaderboardZ: {},
      lbRate: {},
      payoutJobs: {},
      payoutJobsOrder: [],
      payoutIdempotency: {},
      visitorLog: [],
    }
  }
  return memory
}

const VISITORS_MAX = Math.min(
  Math.max(Number(process.env.VISITOR_LOG_MAX) || 5000, 100),
  50_000
)

/**
 * Append a page-view record (newest-first in Redis list / memory array).
 * @param {Record<string, unknown>} entry
 */
export async function recordVisitor(entry) {
  const line = JSON.stringify(entry)
  if (redis) {
    await redis.lPush(VISITORS_LOG_KEY, line)
    await redis.lTrim(VISITORS_LOG_KEY, 0, VISITORS_MAX - 1)
    return
  }
  const m = mem()
  m.visitorLog.unshift(entry)
  if (m.visitorLog.length > VISITORS_MAX) {
    m.visitorLog.length = VISITORS_MAX
  }
}

/**
 * @param {{ limit?: number, offset?: number }} opts
 * @returns {Promise<{ visitors: Record<string, unknown>[], total: number }>}
 */
export async function listVisitors({ limit = 100, offset = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500)
  const off = Math.min(Math.max(Number(offset) || 0, 0), 500_000)
  if (redis) {
    const total = await redis.lLen(VISITORS_LOG_KEY)
    const rows = await redis.lRange(VISITORS_LOG_KEY, off, off + lim - 1)
    return {
      visitors: rows.map((r) => JSON.parse(r)),
      total,
    }
  }
  const log = mem().visitorLog
  const total = log.length
  return { visitors: log.slice(off, off + lim), total }
}

export async function initStore(options = {}) {
  const url = process.env.REDIS_URL?.trim()
  if (url) {
    redis = createClient({ url })
    redis.on("error", (err) => console.error("[redis]", err))
    await redis.connect()
    await redis.set(ARENA_START_KEY, String(Date.now()), { NX: true })
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
  const [a, b, c] = await Promise.all([
    getStat("validations_single"),
    getStat("batch_items"),
    getStat("submits"),
  ])
  return a + b + c
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

/** Clear winner (e.g. after deploy or new puzzle). Does not change loaded PUZZLE from .env. */
export async function clearPuzzleWinnerState() {
  if (redis) {
    await redis.del(PUZZLE_WINNER_KEY)
    return
  }
  const m = mem()
  m.winner = null
}

function payoutIdempotencyKey(puzzleId, winnerAddress, amountUsdc) {
  return `payout:${puzzleId}:${winnerAddress}:${amountUsdc}`
}

export async function createPayoutJob({ puzzleId, winnerAddress, amountUsdc }) {
  const idem = payoutIdempotencyKey(puzzleId, winnerAddress, amountUsdc)
  const maxRetries = Math.max(0, Number(process.env.PAYOUT_MAX_RETRIES) || 5)
  if (!redis) {
    const m = mem()
    const existingId = m.payoutIdempotency[idem]
    if (existingId && m.payoutJobs[existingId]) return null
    const jobId = `payout_${m.payoutJobsOrder.length + 1}`
    const job = {
      job_id: jobId,
      idempotency_key: idem,
      puzzle_id: puzzleId,
      winner_address: winnerAddress,
      amount_usdc: amountUsdc,
      status: "pending",
      retries: 0,
      max_retries: maxRetries,
      tx_sig: null,
      last_error: null,
      created_at_ms: Date.now(),
      updated_at_ms: Date.now(),
    }
    m.payoutJobs[jobId] = job
    m.payoutJobsOrder.unshift(jobId)
    m.payoutIdempotency[idem] = jobId
    return job
  }
  const idemKey = `payout:idem:${idem}`
  let existingId = await redis.get(idemKey)
  if (existingId) {
    return null
  }
  const seq = await redis.incr(PAYOUT_JOB_SEQ_KEY)
  const jobId = `payout_${seq}`
  const job = {
    job_id: jobId,
    idempotency_key: idem,
    puzzle_id: puzzleId,
    winner_address: winnerAddress,
    amount_usdc: amountUsdc,
    status: "pending",
    retries: 0,
    max_retries: maxRetries,
    tx_sig: null,
    last_error: null,
    created_at_ms: Date.now(),
    updated_at_ms: Date.now(),
  }
  const ok = await redis.set(idemKey, jobId, { NX: true })
  if (ok !== "OK") {
    return null
  }
  await redis.set(`payout:job:${jobId}`, JSON.stringify(job))
  await redis.lPush(PAYOUT_JOB_INDEX_KEY, jobId)
  await redis.lTrim(PAYOUT_JOB_INDEX_KEY, 0, 999)
  return job
}

export async function listPayoutJobs(limit = 20) {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 200)
  if (!redis) {
    const m = mem()
    return m.payoutJobsOrder.slice(0, lim).map((id) => m.payoutJobs[id]).filter(Boolean)
  }
  const ids = await redis.lRange(PAYOUT_JOB_INDEX_KEY, 0, lim - 1)
  const raws = await Promise.all(ids.map((id) => redis.get(`payout:job:${id}`)))
  return raws.filter(Boolean).map((x) => JSON.parse(x))
}

export async function recordPayoutAttempt(jobId, { txSig = null, error = null }) {
  if (!jobId) return null
  const maxRetries = Math.max(0, Number(process.env.PAYOUT_MAX_RETRIES) || 5)
  if (!redis) {
    const job = mem().payoutJobs[jobId]
    if (!job) return null
    job.retries = (job.retries || 0) + 1
    job.max_retries = maxRetries
    job.updated_at_ms = Date.now()
    if (txSig) {
      job.tx_sig = txSig
      job.status = "confirmed"
      job.last_error = null
    } else {
      job.last_error = error || "attempt_failed"
      job.status = job.retries >= maxRetries ? "failed" : "pending_retry"
    }
    return job
  }
  const raw = await redis.get(`payout:job:${jobId}`)
  if (!raw) return null
  const job = JSON.parse(raw)
  job.retries = (job.retries || 0) + 1
  job.max_retries = maxRetries
  job.updated_at_ms = Date.now()
  if (txSig) {
    job.tx_sig = txSig
    job.status = "confirmed"
    job.last_error = null
  } else {
    job.last_error = error || "attempt_failed"
    job.status = job.retries >= maxRetries ? "failed" : "pending_retry"
  }
  await redis.set(`payout:job:${jobId}`, JSON.stringify(job))
  return job
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
 * Rate-limited per wallet (LEADERBOARD_MAX_INCR_PER_SEC / sec).
 * @returns true if score changed
 */
export async function recordLeaderboardAttempt(wallet) {
  const key = wallet || "anonymous"
  if (!(await leaderboardIncrAllowed(key))) return false
  if (redis) {
    await redis.zIncrBy(LEADERBOARD_ZSET, 1, key)
    return true
  }
  const lb = mem().leaderboardZ
  lb[key] = (lb[key] || 0) + 1
  return true
}

/**
 * Add win bonus to leaderboard (same ZSET as near-misses; much larger delta).
 * Not rate-limited; only called after atomic winner set succeeds.
 */
export async function recordLeaderboardWin(wallet) {
  const key = wallet || "anonymous"
  const delta = LEADERBOARD_WIN_POINTS
  if (redis) {
    await redis.zIncrBy(LEADERBOARD_ZSET, delta, key)
    return true
  }
  const lb = mem().leaderboardZ
  lb[key] = (lb[key] || 0) + delta
  return true
}

/** Optional anti-spam: negative delta on constraint reject (set LEADERBOARD_CONSTRAINT_PENALTY). */
export async function recordLeaderboardConstraintPenalty(wallet) {
  const delta = Number(process.env.LEADERBOARD_CONSTRAINT_PENALTY)
  if (!Number.isFinite(delta) || delta === 0) return false
  const key = wallet || "anonymous"
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

/** Sorted by score (near-miss +1 each, plus configurable win bonus). Highest first. */
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

export async function getExtendedStats() {
  const fields = [
    "constraint_rejects",
    "invalid_mnemonics",
    "valid_target_misses",
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
