import "dotenv/config"
import { readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { spawn } from "child_process"
import express from "express"
import cors from "cors"
import rateLimit from "express-rate-limit"
import bip39 from "bip39"
import { Connection, PublicKey } from "@solana/web3.js"
import {
  PUZZLE,
  shuffle,
  normalizePhrase,
  evaluateMnemonicCached,
  hashMnemonic,
  validationJson,
  parseSolveMessage,
} from "./puzzle.js"
import { mnemonicToAddressCached, mnemonicToAddress } from "./solana.js"
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
  maybeArchiveRound,
  createPayoutJob,
  listPayoutJobs,
  recordPayoutAttempt,
  startNewRound,
  getLeaderboardScore,
  getLeaderboardRank1Based,
} from "./store.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const APP_VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"))
    return typeof pkg.version === "string" && pkg.version.trim() ? pkg.version.trim() : "0.0.0"
  } catch {
    return "0.0.0"
  }
})()
const app = express()
const PORT = Number(process.env.PORT) || 3001
let DISPLAY_WORDS = shuffle(PUZZLE.words)
const WORKER_SCRIPT = path.join(__dirname, "../worker/worker.js")

const sseClients = new Set()
let workerProcess = null
let workerStartedAtMs = null
let workerStopping = false
let workerStartTimer = null
let workerStartAtMs = null

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
const IS_PROD = process.env.NODE_ENV === "production"
const ADMIN_CONTROL_KEY = process.env.ADMIN_CONTROL_KEY?.trim() || ""
const HOUSE_AGENT_START_DELAY_SEC = Math.max(
  0,
  Math.floor(Number(process.env.HOUSE_AGENT_START_DELAY_SEC) || 0)
)
const HOUSE_AGENT_MAX_ATTEMPTS_PER_SEC = Math.max(
  0,
  Number(process.env.HOUSE_AGENT_MAX_ATTEMPTS_PER_SEC) || 0
)
const AUTO_ROTATE_ROUNDS =
  process.env.AUTO_ROTATE_ROUNDS === "1" || process.env.AUTO_ROTATE_ROUNDS === "true"
const PAYOUT_AMOUNT_USDC = Number(process.env.PAYOUT_AMOUNT_USDC || 0)
const ROUND_ROTATION_JSON = process.env.ROUND_ROTATION_JSON?.trim() || ""
let roundRotation = []
let rotationIndex = 0
let lastAutoRotatedRoundId = null

const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com"
const USDC_MINT =
  process.env.USDC_MINT || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
const PRIZE_BALANCE_TTL_MS = Math.max(
  1000,
  Number(process.env.PRIZE_BALANCE_TTL_MS) || 10_000
)
const solanaConn = new Connection(SOLANA_RPC_URL, "confirmed")
let prizeBalanceCache = null
let prizeBalanceCacheAt = 0

if (ROUND_ROTATION_JSON) {
  try {
    const parsed = JSON.parse(ROUND_ROTATION_JSON)
    if (Array.isArray(parsed)) {
      roundRotation = parsed
    }
  } catch (e) {
    console.error("[round rotation] invalid ROUND_ROTATION_JSON", e)
  }
}

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
  const scheduled = !!workerStartTimer && !running
  return {
    running,
    scheduled,
    pid: running ? workerProcess.pid : null,
    started_at_ms: running ? workerStartedAtMs : null,
    scheduled_start_at_ms: scheduled ? workerStartAtMs : null,
  }
}

function startWorkerProcess() {
  if (getWorkerStatus().running) return getWorkerStatus()
  const env = {
    ...process.env,
    SOLQUEST_API: process.env.SOLQUEST_API || `http://127.0.0.1:${PORT}`,
    WORKER_STRATEGY:
      process.env.HOUSE_AGENT_STRATEGY || process.env.WORKER_STRATEGY || "exhaustive",
    HOUSE_AGENT_ID: process.env.HOUSE_AGENT_ID || "house-default",
    HOUSE_AGENT_MAX_ATTEMPTS_PER_SEC:
      HOUSE_AGENT_MAX_ATTEMPTS_PER_SEC > 0
        ? String(HOUSE_AGENT_MAX_ATTEMPTS_PER_SEC)
        : process.env.HOUSE_AGENT_MAX_ATTEMPTS_PER_SEC || "",
  }
  const p = spawn(process.execPath, [WORKER_SCRIPT], {
    cwd: path.join(__dirname, "../worker"),
    env,
    stdio: "inherit",
  })
  workerProcess = p
  workerStartedAtMs = Date.now()
  workerStartAtMs = null
  workerStartTimer = null
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
  if (workerStartTimer) {
    clearTimeout(workerStartTimer)
    workerStartTimer = null
    workerStartAtMs = null
  }
  if (!getWorkerStatus().running) return getWorkerStatus()
  workerStopping = true
  workerProcess.kill("SIGTERM")
  return getWorkerStatus()
}

function scheduleWorkerStart(delaySec) {
  if (getWorkerStatus().running) return getWorkerStatus()
  if (workerStartTimer) return getWorkerStatus()
  const delayMs = Math.max(0, delaySec * 1000)
  workerStartAtMs = Date.now() + delayMs
  workerStartTimer = setTimeout(() => {
    startWorkerProcess()
  }, delayMs)
  return getWorkerStatus()
}

function requireAdminControl(req, res, next) {
  if (!ADMIN_CONTROL_KEY) {
    return res.status(503).json({ error: "admin_control_not_configured" })
  }
  const given = String(req.headers["x-admin-key"] || "").trim()
  if (!given || given !== ADMIN_CONTROL_KEY) {
    return res.status(401).json({ error: "unauthorized" })
  }
  next()
}

function applyRotationItem(item) {
  if (!item || typeof item !== "object") return false
  if (typeof item.id === "string" && item.id.trim()) PUZZLE.id = item.id.trim()
  if (typeof item.round_id === "string" && item.round_id.trim()) {
    PUZZLE.round_id = item.round_id.trim()
  }
  if (typeof item.target_address === "string" && item.target_address.trim()) {
    PUZZLE.target_address = item.target_address.trim()
  }
  if (typeof item.solution_hash === "string" && item.solution_hash.trim()) {
    PUZZLE.solution_hash = item.solution_hash.trim()
  }
  if (typeof item.difficulty === "string" && item.difficulty.trim()) {
    PUZZLE.difficulty = item.difficulty.trim().toLowerCase()
  }
  if (item.constraints && typeof item.constraints === "object") {
    PUZZLE.constraints = item.constraints
  }
  if (Array.isArray(item.words) && item.words.length === 12) {
    PUZZLE.words = item.words.map((w) => String(w).trim().toLowerCase()).filter(Boolean)
    if (PUZZLE.words.length === 12) {
      DISPLAY_WORDS = shuffle(PUZZLE.words)
    }
  }
  prizeBalanceCache = null
  prizeBalanceCacheAt = 0
  return true
}

async function fetchPrizeBalances() {
  const now = Date.now()
  if (prizeBalanceCache && now - prizeBalanceCacheAt < PRIZE_BALANCE_TTL_MS) {
    return prizeBalanceCache
  }

  const owner = new PublicKey(PUZZLE.target_address)
  const [lamports, tokenAccounts] = await Promise.all([
    solanaConn.getBalance(owner),
    solanaConn.getParsedTokenAccountsByOwner(owner, {
      mint: new PublicKey(USDC_MINT),
    }),
  ])

  let usdc = 0
  for (const { account } of tokenAccounts.value) {
    const amount =
      account?.data?.parsed?.info?.tokenAmount?.uiAmount ??
      Number(account?.data?.parsed?.info?.tokenAmount?.uiAmountString ?? "0")
    usdc += Number(amount) || 0
  }

  prizeBalanceCache = {
    address: PUZZLE.target_address,
    usdc_mint: USDC_MINT,
    usdc_balance: usdc,
    sol_balance: lamports / 1_000_000_000,
    fetched_at_ms: now,
  }
  prizeBalanceCacheAt = now
  return prizeBalanceCache
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

/** Same-origin puzzle wizard (no CDN). Off in production unless ALLOW_WIZARD_DERIVE=1. */
function isWizardDeriveEnabled() {
  return process.env.ALLOW_WIZARD_DERIVE === "1" || process.env.NODE_ENV !== "production"
}

const wizardDeriveLimiter = rateLimit({
  windowMs: 60_000,
  max: Math.min(Math.max(Number(process.env.WIZARD_DERIVE_MAX_PER_MIN) || 40, 5), 200),
  standardHeaders: true,
  legacyHeaders: false,
})

/** Wizard: canonical + Fisher–Yates scrambled pool + fixed first/last for .env */
function buildWizardDerivationFromNormalizedPhrase(n) {
  const wordArr = n.split(" ")
  const target_address = mnemonicToAddress(n)
  const solution_hash = hashMnemonic(n)
  const puzzle_words = wordArr.join(",")
  const puzzle_words_scrambled = shuffle([...wordArr]).join(",")
  const puzzle_constraints_json = JSON.stringify({
    fixed_positions: { "0": wordArr[0], "11": wordArr[11] },
  })
  return {
    target_address,
    solution_hash,
    puzzle_words,
    puzzle_words_scrambled,
    puzzle_constraints_json,
  }
}

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

app.get("/version", (_req, res) => {
  res.json({ version: APP_VERSION })
})

/** Public metadata for /developers (optional operator links + limits). */
app.get("/public/developer-info", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=60")
  res.json({
    api_key_request_url: process.env.API_KEY_REQUEST_URL?.trim() || "",
    api_key_request_email: process.env.API_KEY_REQUEST_EMAIL?.trim() || "",
    free_tier_batch_max: FREE_TIER_BATCH_MAX,
    rate_limit_validate_batch_per_sec:
      Number(process.env.RATE_LIMIT_VALIDATE_BATCH_MAX) || 20,
    wizard_derive_enabled: isWizardDeriveEnabled(),
  })
})

/**
 * Puzzle wizard: derive TARGET_ADDRESS, SOLUTION_HASH, PUZZLE_WORDS (same logic as README).
 * POST JSON: { "mnemonic": "12 words" } or { "generate": true } for a new mnemonic.
 * Disabled in production unless ALLOW_WIZARD_DERIVE=1 (mnemonic in HTTP body — trust your network).
 */
app.post("/public/wizard-derive", wizardDeriveLimiter, (req, res) => {
    if (!isWizardDeriveEnabled()) {
      return res.status(404).json({ error: "wizard_derive_disabled" })
    }
    if (req.body?.generate === true) {
      const mnemonic = bip39.generateMnemonic(128)
      const n = normalizePhrase(mnemonic)
      const d = buildWizardDerivationFromNormalizedPhrase(n)
      return res.json({
        mnemonic,
        valid: true,
        word_count: 12,
        ...d,
      })
    }
    const raw = req.body?.mnemonic
    if (typeof raw !== "string") {
      return res.status(400).json({ error: "missing_mnemonic" })
    }
    const n = normalizePhrase(raw)
    const words = n.split(" ").filter(Boolean)
    if (words.length === 0) {
      return res.json({ valid: false, error: "empty", word_count: 0 })
    }
    if (words.length !== 12) {
      return res.json({
        valid: false,
        error: "word_count",
        word_count: words.length,
      })
    }
    if (!bip39.validateMnemonic(n)) {
      return res.json({ valid: false, error: "invalid_bip39", word_count: 12 })
    }
    const d = buildWizardDerivationFromNormalizedPhrase(n)
    return res.json({
      valid: true,
      word_count: 12,
      ...d,
    })
  }
)

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
    round_start_ms: round.round_start_ms,
    round_end_ms: round.round_end_ms,
    round_active: round.round_active,
    round_phase: round.round_phase,
    round_settle_at_ms: round.round_settle_at_ms,
    round_archive_at_ms: round.round_archive_at_ms,
    round_settled: round.round_settled,
    round_archived: round.round_archived,
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

app.get("/prize/balances", async (_req, res) => {
  try {
    const data = await fetchPrizeBalances()
    res.json(data)
  } catch (e) {
    console.error("[prize/balances]", e)
    res.status(500).json({ error: "prize_balance_unavailable" })
  }
})

app.get("/worker/status", (_req, res) => {
  res.json(getWorkerStatus())
})

app.post("/worker/start", requireAdminControl, (_req, res) => {
  const status =
    HOUSE_AGENT_START_DELAY_SEC > 0
      ? scheduleWorkerStart(HOUSE_AGENT_START_DELAY_SEC)
      : startWorkerProcess()
  res.json({
    status: status.running ? "started" : status.scheduled ? "scheduled" : "failed",
    ...status,
  })
})

app.post("/worker/stop", requireAdminControl, (_req, res) => {
  const prev = getWorkerStatus()
  const status = stopWorkerProcess()
  res.json({
    status: prev.running
      ? "stopping"
      : prev.scheduled
        ? "cancelled_scheduled_start"
        : "already_stopped",
    ...status,
  })
})

app.get("/payout/jobs", async (req, res) => {
  const limit = Number(req.query.limit) || 20
  const jobs = await listPayoutJobs(limit)
  res.json({ jobs })
})

app.post("/payout/jobs/:jobId/attempt", requireAdminControl, async (req, res) => {
  const { jobId } = req.params
  const { tx_sig, error } = req.body ?? {}
  const job = await recordPayoutAttempt(jobId, {
    txSig: tx_sig || null,
    error: error || null,
  })
  if (!job) return res.status(404).json({ error: "job_not_found" })
  res.json(job)
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

app.get("/developers", (_req, res) => {
  res.type("html")
  res.sendFile(path.join(__dirname, "../frontend/developers.html"))
})

app.use(express.static(path.join(__dirname, "../frontend")))

async function tickRoundLifecycle() {
  await maybeSendRoundEndEvent((ev) => broadcast(ev))
  await maybeSettleRound((ev) => broadcast(ev))
  await maybeArchiveRound((ev) => broadcast(ev))

  const round = await getRoundState()
  if (round.round_settled && PAYOUT_AMOUNT_USDC > 0) {
    const state = await getPuzzleState()
    if (state.winner) {
      const job = await createPayoutJob({
        roundId: round.round_id,
        winnerAddress: state.winner,
        amountUsdc: PAYOUT_AMOUNT_USDC,
      })
      if (job) {
        broadcast({
          type: "payout_job",
          job_id: job.job_id,
          round_id: job.round_id,
          winner_address: job.winner_address,
          amount_usdc: job.amount_usdc,
          status: job.status,
        })
      }
    }
  }

  if (
    AUTO_ROTATE_ROUNDS &&
    round.round_archived &&
    round.round_id &&
    round.round_id !== lastAutoRotatedRoundId &&
    roundRotation.length > 0
  ) {
    const item = roundRotation[rotationIndex % roundRotation.length]
    const ok = applyRotationItem(item)
    if (ok) {
      lastAutoRotatedRoundId = round.round_id
      rotationIndex += 1
      const nextRound = await startNewRound({
        roundId: item.round_id || `${round.round_id}-next-${rotationIndex}`,
        durationSec:
          Number(item.round_duration_sec) ||
          Number(process.env.ROUND_DURATION_SEC) ||
          0,
        startDelaySec:
          Number(item.round_start_delay_sec) ||
          Number(process.env.ROUND_START_DELAY_SEC) ||
          0,
      })
      PUZZLE.round_id = nextRound.round_id
      broadcast({
        type: "round_rotated",
        from_round_id: round.round_id,
        to_round_id: nextRound.round_id,
        puzzle_id: PUZZLE.id,
      })
    }
  }
}

async function main() {
  if (IS_PROD && !process.env.REDIS_URL?.trim()) {
    throw new Error("REDIS_URL is required in production")
  }
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
