import "dotenv/config"
import path from "path"
import { fileURLToPath } from "url"
import { spawn } from "child_process"
import express from "express"
import cors from "cors"
import rateLimit from "express-rate-limit"
import {
  PUZZLE,
  shuffle,
  evaluateMnemonicCached,
  hashMnemonic,
  validationJson,
  parseSolveMessage,
} from "./puzzle.js"
import { mnemonicToAddressCached } from "./solana.js"
import { verifySolanaSignature } from "./verify.js"
import {
  initStore,
  recordSingleValidation,
  recordBatchItems,
  recordSubmit,
  recordClaim,
  recordValidChecksum,
  recordValidationOutcome,
  recordGranularEval,
  getAttemptsTotal,
  getValidChecksumsCount,
  getArenaStartMs,
  getPuzzleState,
  trySetWinner,
  trySetWinnerAtomic,
  recordLeaderboardAttempt,
  getLeaderboard,
  acquireClaimLock,
  releaseClaimLock,
  getCachedClaimResult,
  setCachedClaimResult,
  publishArenaEvent,
  isRedisEnabled,
  consumeBatchCredits,
  getExtendedStats,
  recordConstraintReject,
  recordInvalidMnemonic,
  recordAddressMismatch,
  recordValidTargetMiss,
  consumeSignedMessageOnce,
  getRoundState,
  getApiKeyTier,
  isApiKeyValid,
  recordLeaderboardConstraintPenalty,
  CREDITS_SCALE_UNITS,
  maybeSendRoundEndEvent,
  maybeSettleRound,
  getLeaderboardScore,
  getLeaderboardRank1Based,
} from "./store.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = Number(process.env.PORT) || 3001
const DISPLAY_WORDS = shuffle(PUZZLE.words)
const WORKER_SCRIPT = path.join(__dirname, "../worker/worker.js")

const sseClients = new Set()
let workerProcess = null
let workerStartedAtMs = null
let workerStopping = false

const FREE_TIER_BATCH_MAX = Math.min(
  Math.max(Number(process.env.FREE_TIER_BATCH_MAX) || 50, 1),
  500
)
const PAID_TIER_BATCH_MAX = Math.min(
  Math.max(Number(process.env.PAID_TIER_BATCH_MAX) || 1000, 1),
  2000
)
const BATCH_MAX = Math.min(
  Math.max(Number(process.env.VALIDATE_BATCH_MAX) || PAID_TIER_BATCH_MAX, 1),
  PAID_TIER_BATCH_MAX
)
const FREE_TIER_BATCH_CONCURRENCY = Math.min(
  Math.max(Number(process.env.FREE_TIER_BATCH_CONCURRENCY) || 8, 1),
  128
)
const PAID_TIER_BATCH_CONCURRENCY = Math.min(
  Math.max(Number(process.env.PAID_TIER_BATCH_CONCURRENCY) || 32, 1),
  128
)
const BATCH_CONCURRENCY = PAID_TIER_BATCH_CONCURRENCY
const BATCH_CREDIT_BASE =
  process.env.BATCH_CREDIT_BASE != null && process.env.BATCH_CREDIT_BASE !== ""
    ? Number(process.env.BATCH_CREDIT_BASE)
    : 0
const BATCH_CREDIT_UNIT =
  process.env.BATCH_CREDIT_UNIT != null && process.env.BATCH_CREDIT_UNIT !== ""
    ? Number(process.env.BATCH_CREDIT_UNIT)
    : 1

const CLAIM_WINDOW_SEC = Math.min(
  Math.max(Number(process.env.CLAIM_SIGNATURE_WINDOW_SEC) || 30, 5),
  300
)

const ALLOW_LEGACY_MESSAGE =
  process.env.ALLOW_LEGACY_SOLVE_MESSAGE === "1" ||
  process.env.ALLOW_LEGACY_SOLVE_MESSAGE === "true"

const CLAIM_REQUIRE_NONCE =
  process.env.CLAIM_REQUIRE_NONCE === "1" ||
  process.env.CLAIM_REQUIRE_NONCE === "true"

/** When true, only `solve:{id}:{ts}:{nonce}:{mnemonic_hash}` is accepted (strongest). */
const CLAIM_REQUIRE_MNEMONIC_BINDING =
  process.env.CLAIM_REQUIRE_MNEMONIC_BINDING === "1" ||
  process.env.CLAIM_REQUIRE_MNEMONIC_BINDING === "true"

const CLAIM_REQUIRE_ROUND_IN_MESSAGE =
  process.env.CLAIM_REQUIRE_ROUND_IN_MESSAGE === "1" ||
  process.env.CLAIM_REQUIRE_ROUND_IN_MESSAGE === "true"

function localBroadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`
  for (const res of sseClients) {
    try {
      res.write(payload)
    } catch {
      sseClients.delete(res)
    }
  }
}

function broadcast(event) {
  if (isRedisEnabled()) {
    publishArenaEvent(event).catch(() => {})
  } else {
    localBroadcast(event)
  }
}

function getWorkerStatus() {
  const running =
    !!workerProcess && workerProcess.exitCode == null && workerProcess.killed !== true
  return {
    running,
    pid: running ? workerProcess.pid : null,
    started_at_ms: running ? workerStartedAtMs : null,
  }
}

function startWorkerProcess() {
  if (getWorkerStatus().running) return getWorkerStatus()
  const env = {
    ...process.env,
    SOLQUEST_API: process.env.SOLQUEST_API || `http://127.0.0.1:${PORT}`,
  }
  const p = spawn(process.execPath, [WORKER_SCRIPT], {
    cwd: path.join(__dirname, "../worker"),
    env,
    stdio: "inherit",
  })
  workerProcess = p
  workerStartedAtMs = Date.now()
  workerStopping = false

  p.on("exit", (code, signal) => {
    const wasStopping = workerStopping
    workerProcess = null
    workerStartedAtMs = null
    workerStopping = false
    broadcast({
      type: "worker_status",
      running: false,
      code: code ?? null,
      signal: signal ?? null,
      reason: wasStopping ? "stopped" : "exited",
    })
  })

  p.on("error", (err) => {
    console.error("[worker]", err)
  })

  broadcast({ type: "worker_status", ...getWorkerStatus(), reason: "started" })
  return getWorkerStatus()
}

function stopWorkerProcess() {
  if (!getWorkerStatus().running) return getWorkerStatus()
  workerStopping = true
  workerProcess.kill("SIGTERM")
  return getWorkerStatus()
}

async function broadcastLeaderboardScoreEvents(pubkey) {
  broadcast({ type: "attempt", pubkey, delta: 1, puzzle_id: PUZZLE.id })
  const top = await getLeaderboard(5)
  broadcast({ type: "leaderboard_update", top, puzzle_id: PUZZLE.id })
}

async function broadcastLeaderboardRefresh() {
  const top = await getLeaderboard(5)
  broadcast({ type: "leaderboard_update", top, puzzle_id: PUZZLE.id })
}

async function evalAndRecord(raw) {
  const ev = evaluateMnemonicCached(raw)
  if (ev.valid_checksum === true) {
    await recordValidChecksum()
  }
  await recordGranularEval(ev)
  await recordValidationOutcome(ev)
  return ev
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  }
  const n = Math.min(limit, items.length) || 1
  await Promise.all(Array.from({ length: n }, () => worker()))
  return results
}

app.use(cors())
app.use(express.json({ limit: "2mb" }))

const validateLimiter = rateLimit({
  windowMs: 1000,
  max: Number(process.env.RATE_LIMIT_VALIDATE_MAX) || 120,
  standardHeaders: true,
  legacyHeaders: false,
})

const validateBatchLimiter = rateLimit({
  windowMs: 1000,
  max: Number(process.env.RATE_LIMIT_VALIDATE_BATCH_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
})

const submitLimiter = rateLimit({
  windowMs: 1000,
  max: Number(process.env.RATE_LIMIT_SUBMIT_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
})

const claimLimiter = rateLimit({
  windowMs: 1000,
  max: Number(process.env.RATE_LIMIT_CLAIM_MAX) || 60,
  standardHeaders: true,
  legacyHeaders: false,
})

async function batchCreditsMiddleware(req, res, next) {
  const n = Array.isArray(req.body?.mnemonics) ? req.body.mnemonics.length : 0
  const key = req.headers["x-api-key"]
  if (key?.trim() && !(await isApiKeyValid(key))) {
    return res.status(401).json({ error: "invalid_api_key" })
  }
  const tier = await getApiKeyTier(key)
  const maxBatch = tier === "free" ? FREE_TIER_BATCH_MAX : PAID_TIER_BATCH_MAX
  if (n > maxBatch) {
    return res.status(400).json({
      error: "batch_too_large",
      max: maxBatch,
      tier,
    })
  }
  const costMicro = Math.round(
    (BATCH_CREDIT_BASE + n * BATCH_CREDIT_UNIT) * CREDITS_SCALE_UNITS
  )
  req.batchTier = tier
  req.batchConcurrency =
    tier === "free" ? FREE_TIER_BATCH_CONCURRENCY : PAID_TIER_BATCH_CONCURRENCY
  const r = await consumeBatchCredits(key, costMicro)
  if (!r.ok) {
    const code = r.error === "insufficient_credits" ? 402 : 401
    return res.status(code).json({ error: r.error, cost })
  }
  next()
}

app.get("/health", (_req, res) => {
  res.json({ ok: true })
})

app.get("/puzzle", async (_req, res) => {
  const state = await getPuzzleState()
  const round = await getRoundState()
  res.json({
    id: PUZZLE.id,
    round_id: PUZZLE.round_id,
    difficulty: PUZZLE.difficulty,
    words: DISPLAY_WORDS,
    solved: state.solved,
    solution_hash: PUZZLE.solution_hash,
    target_address: PUZZLE.target_address,
    constraints: PUZZLE.constraints,
    winner: state.winner,
    round_end_ms: round.round_end_ms,
    round_active: round.round_active,
    round_phase: round.round_phase,
    round_settle_at_ms: round.round_settle_at_ms,
    round_settled: round.round_settled,
    round_leaderboard_winner: round.round_leaderboard_winner,
  })
})

app.get("/stats", async (_req, res) => {
  const start = await getArenaStartMs()
  const state = await getPuzzleState()
  const extra = await getExtendedStats()
  const attempts_total = await getAttemptsTotal()
  const valid_checksums = await getValidChecksumsCount()
  const time_elapsed = Math.max(1, Math.floor((Date.now() - start) / 1000))
  res.json({
    attempts_total,
    valid_checksums,
    valid_rate: attempts_total > 0 ? valid_checksums / attempts_total : null,
    active_agents: sseClients.size,
    solved: state.solved,
    time_elapsed,
    attempts_per_sec: attempts_total / time_elapsed,
    ...extra,
  })
})

app.get("/worker/status", (_req, res) => {
  res.json(getWorkerStatus())
})

app.post("/worker/start", (_req, res) => {
  const status = startWorkerProcess()
  res.json({ status: status.running ? "started" : "failed", ...status })
})

app.post("/worker/stop", (_req, res) => {
  const prev = getWorkerStatus()
  const status = stopWorkerProcess()
  res.json({ status: prev.running ? "stopping" : "already_stopped", ...status })
})

app.post("/validate", validateLimiter, async (req, res) => {
  await recordSingleValidation()
  const { mnemonic } = req.body ?? {}
  const ev = await evalAndRecord(mnemonic)
  res.json(validationJson(ev))
})

app.post(
  "/validate_batch",
  validateBatchLimiter,
  batchCreditsMiddleware,
  async (req, res) => {
    const { mnemonics } = req.body ?? {}
    if (!Array.isArray(mnemonics)) {
      return res.status(400).json({ error: "mnemonics must be an array" })
    }
    if (mnemonics.length > BATCH_MAX) {
      return res.status(400).json({
        error: `batch too large (max ${BATCH_MAX})`,
      })
    }

    await recordBatchItems(mnemonics.length)

    try {
      const conc = req.batchConcurrency ?? BATCH_CONCURRENCY
      const results = await mapWithConcurrency(
        mnemonics,
        conc,
        async (m) => {
          const ev = await evalAndRecord(m)
          return validationJson(ev)
        }
      )
      res.json(results)
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: "batch_failed" })
    }
  }
)

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream")
  res.setHeader("Cache-Control", "no-cache")
  res.setHeader("Connection", "keep-alive")
  res.flushHeaders?.()
  sseClients.add(res)
  res.write(`data: ${JSON.stringify({ type: "hello", puzzle_id: PUZZLE.id })}\n\n`)
  req.on("close", () => {
    sseClients.delete(res)
  })
})

/**
 * Order: parse → window → solved → verify signature → binding + round → idempotency / round freeze → lock → replay → eval.
 * Message: `solve:{round}:{id}:{ts}:{nonce}:{sha256_hex}` or `solve:{id}:{ts}:{nonce}:{sha256_hex}`; weaker formats if env allows.
 */
app.post("/claim", claimLimiter, async (req, res) => {
  try {
    const { mnemonic, pubkey, signature, message } = req.body ?? {}

    if (
      typeof pubkey !== "string" ||
      typeof signature !== "string" ||
      !pubkey ||
      !signature
    ) {
      return res.status(400).json({ error: "missing_pubkey_or_signature" })
    }

    const parsed = parseSolveMessage(
      message,
      PUZZLE.id,
      ALLOW_LEGACY_MESSAGE,
      CLAIM_REQUIRE_NONCE,
      CLAIM_REQUIRE_MNEMONIC_BINDING,
      CLAIM_REQUIRE_ROUND_IN_MESSAGE
    )
    if (!parsed) {
      return res.status(400).json({
        error: "bad_message",
        expected: CLAIM_REQUIRE_ROUND_IN_MESSAGE
          ? `solve:<round_id>:${PUZZLE.id}:<unix_ts>:<nonce>:<mnemonic_sha256_hex>`
          : CLAIM_REQUIRE_MNEMONIC_BINDING
            ? `solve:${PUZZLE.id}:<unix_ts>:<nonce>:<mnemonic_sha256_hex>`
            : CLAIM_REQUIRE_NONCE
              ? `solve:${PUZZLE.id}:<unix_ts>:<nonce>[:<mnemonic_sha256_hex>]`
              : `solve:${PUZZLE.id}:<unix_ts>[:<nonce>[:<mnemonic_sha256_hex>]]`,
        legacy_allowed: ALLOW_LEGACY_MESSAGE,
        nonce_required: CLAIM_REQUIRE_NONCE,
        mnemonic_binding_required: CLAIM_REQUIRE_MNEMONIC_BINDING,
        round_in_message_required: CLAIM_REQUIRE_ROUND_IN_MESSAGE,
      })
    }

    if (
      parsed.mode === "timestamp" ||
      parsed.mode === "timestamp_nonce" ||
      parsed.mode === "timestamp_nonce_binding"
    ) {
      const now = Math.floor(Date.now() / 1000)
      if (Math.abs(now - parsed.ts) > CLAIM_WINDOW_SEC) {
        return res.status(400).json({
          error: "signature_expired",
          max_skew_sec: CLAIM_WINDOW_SEC,
        })
      }
    }

    if (parsed.roundId != null && parsed.roundId !== PUZZLE.round_id) {
      return res.status(400).json({ status: "wrong_round" })
    }

    const state0 = await getPuzzleState()
    if (state0.solved) {
      const body = { status: "already_solved", winner: state0.winner }
      return res.json(body)
    }

    if (!verifySolanaSignature(pubkey, message, signature)) {
      return res.status(401).json({ error: "bad_signature" })
    }

    const mnemonicHash = hashMnemonic(mnemonic ?? "")

    if (parsed.mode === "timestamp_nonce_binding") {
      if (parsed.mnemonicHash !== mnemonicHash) {
        return res.status(400).json({ status: "invalid_signature_binding" })
      }
    }

    const rs = await getRoundState()
    if (!rs.round_active) {
      const cachedRound = await getCachedClaimResult(pubkey, mnemonicHash)
      if (cachedRound) {
        return res.json(cachedRound)
      }
      return res.status(400).json({
        status: "round_ended",
        round_id: rs.round_id,
      })
    }

    const cached = await getCachedClaimResult(pubkey, mnemonicHash)
    if (cached) {
      return res.json(cached)
    }

    const locked = await acquireClaimLock()
    if (!locked) {
      return res.json({ status: "lost_race" })
    }

    try {
      const stateLocked = await getPuzzleState()
      if (stateLocked.solved) {
        const body = { status: "already_solved", winner: stateLocked.winner }
        await setCachedClaimResult(pubkey, mnemonicHash, body, 120)
        return res.json(body)
      }

      const msgOnce = await consumeSignedMessageOnce(pubkey, message)
      if (!msgOnce) {
        return res.status(400).json({ error: "message_replay" })
      }

      await recordClaim()

      const state = await getPuzzleState()
      if (state.solved) {
        const body = { status: "already_solved", winner: state.winner }
        await setCachedClaimResult(pubkey, mnemonicHash, body, 120)
        return res.json(body)
      }

      const ev = evaluateMnemonicCached(mnemonic)
      if (ev.valid_checksum === true) {
        await recordValidChecksum()
      }
      await recordGranularEval(ev)

      if (ev.rejected_by_constraints) {
        await recordConstraintReject()
        const penalized = await recordLeaderboardConstraintPenalty(pubkey)
        if (penalized) await broadcastLeaderboardRefresh()
        const body = { status: "constraint_violation" }
        await setCachedClaimResult(pubkey, mnemonicHash, body, 120)
        return res.json(body)
      }

      if (ev.valid_checksum !== true) {
        await recordInvalidMnemonic()
        const body = { status: "invalid" }
        await setCachedClaimResult(pubkey, mnemonicHash, body, 60)
        return res.json(body)
      }

      const derived = mnemonicToAddressCached(ev.phrase)
      if (derived !== pubkey) {
        await recordAddressMismatch()
        return res.status(400).json({ error: "pubkey_mismatch" })
      }

      if (!ev.matches_target) {
        await recordValidTargetMiss()
        const added = await recordLeaderboardAttempt(pubkey)
        broadcast({
          type: "claim",
          status: "valid_but_wrong",
          pubkey,
          puzzle_id: PUZZLE.id,
        })
        if (added) await broadcastLeaderboardScoreEvents(pubkey)
        const body = { status: "valid_but_wrong" }
        await setCachedClaimResult(pubkey, mnemonicHash, body, 120)
        return res.json(body)
      }

      const won = await trySetWinnerAtomic(pubkey)
      if (!won) {
        const s2 = await getPuzzleState()
        const body = { status: "already_solved", winner: s2.winner }
        await setCachedClaimResult(pubkey, mnemonicHash, body, 120)
        return res.json(body)
      }

      const body = { status: "win", winner: pubkey }
      await setCachedClaimResult(pubkey, mnemonicHash, body, 3600)
      broadcast({ type: "win", winner: pubkey, puzzle_id: PUZZLE.id })
      broadcast({
        type: "claim",
        status: "win",
        pubkey,
        puzzle_id: PUZZLE.id,
      })
      return res.json(body)
    } finally {
      await releaseClaimLock()
    }
  } catch (e) {
    console.error(e)
    if (!res.headersSent) {
      res.status(500).json({ status: "error", message: "internal_error" })
    }
  }
})

app.post("/submit", submitLimiter, async (req, res) => {
  try {
    await recordSubmit()
    const rawPhrase = req.body?.phrase ?? req.body?.mnemonic
    const wallet = req.body?.wallet ?? "anonymous"

    const state = await getPuzzleState()
    if (state.solved) {
      broadcast({
        type: "submit",
        status: "already_solved",
        wallet,
        puzzle_id: PUZZLE.id,
      })
      return res.json({
        status: "already_solved",
        winner: state.winner,
      })
    }

    const round = await getRoundState()
    if (!round.round_active) {
      return res.status(400).json({
        status: "round_ended",
        round_id: round.round_id,
      })
    }

    const ev = await evalAndRecord(rawPhrase)

    if (ev.rejected_by_constraints) {
      const penalized = await recordLeaderboardConstraintPenalty(wallet)
      if (penalized) await broadcastLeaderboardRefresh()
      broadcast({
        type: "submit",
        status: "constraint_violation",
        wallet,
        puzzle_id: PUZZLE.id,
      })
      return res.json({ status: "constraint_violation" })
    }

    if (ev.valid_checksum !== true) {
      broadcast({
        type: "submit",
        status: "invalid",
        wallet,
        puzzle_id: PUZZLE.id,
      })
      return res.json({ status: "invalid" })
    }

    if (ev.matches_target) {
      const won = await trySetWinner(wallet)
      if (!won) {
        const s2 = await getPuzzleState()
        return res.json({ status: "already_solved", winner: s2.winner })
      }
      broadcast({ type: "win", winner: wallet, puzzle_id: PUZZLE.id })
      broadcast({
        type: "submit",
        status: "win",
        wallet,
        puzzle_id: PUZZLE.id,
      })
      return res.json({ status: "win", winner: wallet })
    }

    const added = await recordLeaderboardAttempt(wallet)
    broadcast({
      type: "submit",
      status: "valid_but_wrong",
      wallet,
      puzzle_id: PUZZLE.id,
    })
    if (added) await broadcastLeaderboardScoreEvents(wallet)
    return res.json({ status: "valid_but_wrong" })
  } catch (e) {
    console.error(e)
    if (!res.headersSent) {
      res.status(500).json({ status: "error", message: "internal_error" })
    }
  }
})

app.get("/leaderboard", async (req, res) => {
  const limit = req.query.limit
  const wallet = String(req.query.wallet || "").trim()
  const top = await getLeaderboard(limit)
  if (!wallet) {
    return res.json({ top })
  }
  const score = await getLeaderboardScore(wallet)
  const rank = await getLeaderboardRank1Based(wallet)
  const leaderScore = top[0]?.score ?? 0
  const gap = Math.max(0, leaderScore - (score ?? 0))
  res.json({
    top,
    self: {
      pubkey: wallet,
      score: score ?? 0,
      rank,
      leader_score: leaderScore,
      gap_to_leader: gap,
    },
  })
})

app.use(express.static(path.join(__dirname, "../frontend")))

async function tickRoundLifecycle() {
  await maybeSendRoundEndEvent((ev) => broadcast(ev))
  await maybeSettleRound((ev) => broadcast(ev))
}

async function main() {
  await initStore({
    onRedisBroadcast: localBroadcast,
  })

  setInterval(() => {
    tickRoundLifecycle().catch(() => {})
  }, 1000)

  const server = app.listen(PORT, () => {
    console.log(`Backend + static frontend: http://localhost:${PORT}`)
    console.log(`Open http://localhost:${PORT}/index.html`)
  })

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `Port ${PORT} is already in use. Stop the other process or run:\n  PORT=3002 node server.js`
      )
    } else {
      console.error(err)
    }
    process.exit(1)
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
