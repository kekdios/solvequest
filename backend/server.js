import "dotenv/config"
import { readFileSync } from "fs"
import { randomBytes } from "crypto"
import path from "path"
import { fileURLToPath } from "url"
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
  applyPuzzleRowFromVault,
  loadPuzzleFromEnv,
  parseConstraintsJson,
} from "./puzzle.js"
import { parsePuzzleSource, PUZZLE_SOURCE_SQLITE } from "./puzzle-vault-env.js"
import {
  openPuzzleVaultDatabase,
  getActiveUnsolvedPuzzle,
  retireAllUnsolvedPuzzles,
  insertUnsolvedPuzzleRow,
} from "./puzzle-vault-db.js"
import { tryQuestFundAfterBootstrap } from "./quest-spl-fund.js"
import { mnemonicToAddress } from "./solana.js"
import {
  initStore,
  recordSingleValidation,
  recordBatchItems,
  recordSubmit,
  recordValidChecksum,
  recordValidationOutcome,
  recordGranularEval,
  getAttemptsTotal,
  getValidChecksumsCount,
  getArenaStartMs,
  getPuzzleState,
  trySetWinner,
  clearPuzzleWinnerState,
  recordLeaderboardAttempt,
  recordLeaderboardWin,
  getLeaderboard,
  publishArenaEvent,
  isRedisEnabled,
  getExtendedStats,
  getRoundState,
  recordLeaderboardConstraintPenalty,
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

/** Avoid stale solved/winner in browsers and reverse proxies (GET must reflect Redis). */
function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate")
  res.setHeader("Pragma", "no-cache")
}
/** Shuffled display order; set in `refreshDisplayWords` after env or vault load. */
let DISPLAY_WORDS = []

function refreshDisplayWords() {
  if (!PUZZLE.words?.length) {
    throw new Error("PUZZLE.words is empty — set env puzzle or run vault bootstrap")
  }
  DISPLAY_WORDS = shuffle(PUZZLE.words)
}

if (parsePuzzleSource() !== PUZZLE_SOURCE_SQLITE) {
  refreshDisplayWords()
}

/** Open SQLite vault (PUZZLE_SOURCE=sqlite); kept open for future rotation. */
export let puzzleVaultHandle = null

/** True when PUZZLE_SOURCE=sqlite but there is no unsolved row (puzzle served from env until bootstrap + restart). */
export let puzzleVaultEmpty = false

function loadPuzzleFromSqliteVault() {
  if (parsePuzzleSource() !== PUZZLE_SOURCE_SQLITE) {
    puzzleVaultEmpty = false
    return
  }
  puzzleVaultHandle = openPuzzleVaultDatabase()
  if (!puzzleVaultHandle) {
    throw new Error("PUZZLE_SOURCE=sqlite but vault database did not open")
  }
  const row = getActiveUnsolvedPuzzle(puzzleVaultHandle.db)
  if (row) {
    puzzleVaultEmpty = false
    applyPuzzleRowFromVault(row)
    refreshDisplayWords()
    return
  }
  puzzleVaultEmpty = true
  // Empty vault after migrate: keep process up for deploy/health checks; same env vars bootstrap-from-env will insert.
  console.warn(
    "[vault] No unsolved row in SQLite yet — using TARGET_ADDRESS / PUZZLE_WORDS from env. Run vault-init bootstrap-from-env then restart to read from the vault."
  )
  Object.assign(PUZZLE, loadPuzzleFromEnv())
  refreshDisplayWords()
}

const sseClients = new Set()

const BATCH_MAX = Math.min(
  Math.max(
    Number(process.env.VALIDATE_BATCH_MAX) ||
      Number(process.env.PAID_TIER_BATCH_MAX) ||
      1000,
    1
  ),
  2000
)
const BATCH_CONCURRENCY = Math.min(
  Math.max(
    Number(process.env.VALIDATE_BATCH_CONCURRENCY) ||
      Number(process.env.PAID_TIER_BATCH_CONCURRENCY) ||
      32,
    1
  ),
  128
)

const IS_PROD = process.env.NODE_ENV === "production"
const ADMIN_CONTROL_KEY = process.env.ADMIN_CONTROL_KEY?.trim() || ""
const AUTO_ROTATE_ROUNDS =
  process.env.AUTO_ROTATE_ROUNDS === "1" || process.env.AUTO_ROTATE_ROUNDS === "true"
const PAYOUT_AMOUNT_USDC = Number(process.env.PAYOUT_AMOUNT_USDC || 0)
const ROUND_ROTATION_JSON = process.env.ROUND_ROTATION_JSON?.trim() || ""
let roundRotation = []
let rotationIndex = 0
let lastAutoRotatedRoundId = null

const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com"
/** SPL mint for prize token balance on `TARGET_ADDRESS` (default SAUSD). */
const PRIZE_SPL_MINT =
  process.env.PRIZE_SPL_MINT?.trim() ||
  process.env.USDC_MINT?.trim() ||
  "CK9PodBifHymLBGeZujExFnpoLCsYxAw7t8c8LsDKLxG"
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
      mint: new PublicKey(PRIZE_SPL_MINT),
    }),
  ])

  let tokenUi = 0
  for (const { account } of tokenAccounts.value) {
    const amount =
      account?.data?.parsed?.info?.tokenAmount?.uiAmount ??
      Number(account?.data?.parsed?.info?.tokenAmount?.uiAmountString ?? "0")
    tokenUi += Number(amount) || 0
  }

  prizeBalanceCache = {
    address: PUZZLE.target_address,
    prize_token_mint: PRIZE_SPL_MINT,
    prize_token_balance: tokenUi,
    // Legacy keys (same as prize_token_*); kept for older clients
    usdc_mint: PRIZE_SPL_MINT,
    usdc_balance: tokenUi,
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
  async function runSlot() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  }
  const n = Math.min(limit, items.length) || 1
  await Promise.all(Array.from({ length: n }, () => runSlot()))
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

/** Same-origin puzzle wizard (no CDN). Off in production unless ALLOW_WIZARD_DERIVE is truthy. */
function parseEnvTruthy(name) {
  const v = process.env[name]?.trim().toLowerCase()
  if (!v) return null
  if (["1", "true", "yes", "on"].includes(v)) return true
  if (["0", "false", "no", "off"].includes(v)) return false
  return null
}

function isWizardDeriveEnabled() {
  const w = parseEnvTruthy("ALLOW_WIZARD_DERIVE")
  if (w === false) return false
  if (w === true) return true
  return process.env.NODE_ENV !== "production"
}

const wizardDeriveLimiter = rateLimit({
  windowMs: 60_000,
  max: Math.min(Math.max(Number(process.env.WIZARD_DERIVE_MAX_PER_MIN) || 40, 5), 200),
  standardHeaders: true,
  legacyHeaders: false,
})

const wizardClearSolvedLimiter = rateLimit({
  windowMs: 60_000,
  max: Math.min(Math.max(Number(process.env.WIZARD_CLEAR_SOLVED_MAX_PER_MIN) || 20, 3), 100),
  standardHeaders: true,
  legacyHeaders: false,
})

const adminNewPuzzleLimiter = rateLimit({
  windowMs: 60_000,
  max: Math.min(Math.max(Number(process.env.ADMIN_NEW_PUZZLE_MAX_PER_MIN) || 8, 2), 30),
  standardHeaders: true,
  legacyHeaders: false,
})

/** Draft generation (no DB write); separate cap so operators can regenerate without burning create quota. */
const adminNewPuzzleDraftLimiter = rateLimit({
  windowMs: 60_000,
  max: Math.min(Math.max(Number(process.env.ADMIN_NEW_PUZZLE_DRAFT_MAX_PER_MIN) || 20, 5), 60),
  standardHeaders: true,
  legacyHeaders: false,
})

function parseAdminNewPuzzlePayload(body) {
  const target_address = String(body?.target_address ?? "").trim()
  const solution_hash = String(body?.solution_hash ?? "").trim()
  const wordsRaw = String(body?.puzzle_words ?? body?.puzzle_words_csv ?? "").trim()
  const public_id = String(body?.public_id ?? body?.puzzle_id ?? "").trim()
  const round_id = String(body?.round_id ?? "default").trim() || "default"
  let constraints_json = null
  if (body?.constraints_json != null && String(body.constraints_json).trim() !== "") {
    const cj = body.constraints_json
    const s = typeof cj === "string" ? cj.trim() : JSON.stringify(cj)
    parseConstraintsJson(s)
    constraints_json = s
  }
  const difficulty =
    body?.difficulty != null && String(body.difficulty).trim()
      ? String(body.difficulty).trim().toLowerCase()
      : null

  if (!target_address) {
    throw new Error("target_address is required")
  }
  try {
    new PublicKey(target_address)
  } catch {
    throw new Error("target_address is not a valid Solana address")
  }
  if (!/^[0-9a-fA-F]{64}$/.test(solution_hash)) {
    throw new Error("solution_hash must be 64 hex characters (SHA-256 commitment)")
  }
  const words = wordsRaw
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
  if (words.length !== 12) {
    throw new Error("puzzle_words must be exactly 12 comma-separated BIP39 words")
  }
  if (!public_id || public_id.length > 64) {
    throw new Error("public_id is required (unique puzzle id, max 64 characters)")
  }

  return {
    public_id,
    target_address,
    solution_hash: solution_hash.toLowerCase(),
    puzzle_words_csv: words.join(","),
    constraints_json,
    round_id,
    difficulty,
  }
}

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

app.get("/health", (_req, res) => {
  res.json({ ok: true })
})

app.get("/version", (_req, res) => {
  setNoStore(res)
  res.json({ version: APP_VERSION })
})

/** Public metadata for /developers (batch limits + rate caps + wizard flag). */
app.get("/public/developer-info", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=60")
  res.json({
    validate_batch_max: BATCH_MAX,
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

/**
 * Clear Redis/in-memory puzzle winner so the arena shows unsolved for the
 * currently running process (same .env). Requires ADMIN_CONTROL_KEY via x-admin-key.
 */
app.post(
  "/public/wizard-clear-solved",
  wizardClearSolvedLimiter,
  requireAdminControl,
  async (_req, res) => {
    try {
      await clearPuzzleWinnerState()
      broadcast({ type: "puzzle_cleared", puzzle_id: PUZZLE.id })
      res.json({ ok: true })
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) })
    }
  }
)

/**
 * SQLite vault only: generate a random mnemonic and derived puzzle row fields (same rules as
 * wizard-derive). Does not write the vault — operator reviews then POST /public/admin/new-puzzle.
 */
app.post(
  "/public/admin/new-puzzle-draft",
  adminNewPuzzleDraftLimiter,
  requireAdminControl,
  async (req, res) => {
    try {
      if (parsePuzzleSource() !== PUZZLE_SOURCE_SQLITE || !puzzleVaultHandle?.db) {
        return res.status(400).json({
          error: "vault_only",
          detail: "PUZZLE_SOURCE must be sqlite and the vault must be open",
        })
      }
      const round_id = String(req.body?.round_id ?? "default").trim() || "default"
      const mnemonic = bip39.generateMnemonic(128)
      const n = normalizePhrase(mnemonic)
      const d = buildWizardDerivationFromNormalizedPhrase(n)
      const public_id = `p${Date.now()}-${randomBytes(2).toString("hex")}`
      res.json({
        ok: true,
        draft: {
          mnemonic,
          public_id,
          target_address: d.target_address,
          solution_hash: d.solution_hash,
          puzzle_words: d.puzzle_words,
          constraints_json: d.puzzle_constraints_json,
          round_id,
          difficulty: null,
        },
      })
    } catch (e) {
      console.error("[admin new-puzzle-draft]", e)
      res.status(500).json({ error: "draft_failed", detail: String(e?.message || e) })
    }
  }
)

/**
 * SQLite vault only: retire current unsolved row(s), insert a new puzzle, reload in-memory PUZZLE,
 * clear Redis winner, optional QUEST auto-fund. Requires unique public_id (e.g. 002, 003).
 */
app.post(
  "/public/admin/new-puzzle",
  adminNewPuzzleLimiter,
  requireAdminControl,
  async (req, res) => {
    try {
      if (parsePuzzleSource() !== PUZZLE_SOURCE_SQLITE || !puzzleVaultHandle?.db) {
        return res.status(400).json({
          error: "vault_only",
          detail: "PUZZLE_SOURCE must be sqlite and the vault must be open",
        })
      }
      const payload = parseAdminNewPuzzlePayload(req.body ?? {})
      const { db, vault } = puzzleVaultHandle
      retireAllUnsolvedPuzzles(db, vault)
      const rowId = insertUnsolvedPuzzleRow(db, vault, payload)
      const row = getActiveUnsolvedPuzzle(db)
      if (!row) {
        throw new Error("no active unsolved row after insert")
      }
      applyPuzzleRowFromVault(row)
      puzzleVaultEmpty = false
      refreshDisplayWords()
      await clearPuzzleWinnerState()
      prizeBalanceCache = null
      prizeBalanceCacheAt = 0

      let quest_fund_tx = null
      let quest_fund_error = null
      try {
        quest_fund_tx = await tryQuestFundAfterBootstrap(db, rowId)
      } catch (e) {
        quest_fund_error = String(e?.message || e)
        console.error("[admin new-puzzle] QUEST fund failed (puzzle is live):", e)
      }

      broadcast({
        type: "new_puzzle",
        puzzle_id: PUZZLE.id,
        row_id: rowId,
      })
      res.json({
        ok: true,
        puzzle_id: PUZZLE.id,
        row_id: rowId,
        quest_fund_tx,
        quest_fund_error,
      })
    } catch (e) {
      const msg = String(e?.message || e)
      if (msg.includes("public_id already")) {
        return res.status(409).json({ error: "public_id_conflict", detail: msg })
      }
      if (
        msg.includes("required") ||
        msg.includes("must be") ||
        msg.includes("valid") ||
        msg.includes("constraints JSON") ||
        msg.includes("invalid JSON")
      ) {
        return res.status(400).json({ error: "validation_error", detail: msg })
      }
      console.error("[admin new-puzzle]", e)
      res.status(500).json({ error: "new_puzzle_failed", detail: msg })
    }
  }
)

app.get("/puzzle", async (_req, res) => {
  setNoStore(res)
  const state = await getPuzzleState()
  const round = await getRoundState()
  res.json({
    id: PUZZLE.id,
    round_id: PUZZLE.round_id,
    difficulty: PUZZLE.difficulty,
    words: DISPLAY_WORDS,
    solved: state.solved,
    // True when sqlite vault has no unsolved row (env fallback); arena shows red operator banner.
    vault_empty: puzzleVaultEmpty,
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
  setNoStore(res)
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

app.post("/validate_batch", validateBatchLimiter, async (req, res) => {
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
    const results = await mapWithConcurrency(
      mnemonics,
      BATCH_CONCURRENCY,
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
})

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
      await recordLeaderboardWin(wallet)
      await broadcastLeaderboardRefresh()
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
  setNoStore(res)
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

/** Stable URL for Solana token / Metaplex image (same file as /icon_quest.png). */
app.get("/@frontend/icon_quest.png", (_req, res) => {
  res.type("image/png")
  res.setHeader("Cache-Control", "public, max-age=86400")
  res.sendFile(path.join(__dirname, "../frontend/icon_quest.png"))
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

  loadPuzzleFromSqliteVault()

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
