import crypto from "crypto"
import { LRUCache } from "lru-cache"
import bip39 from "bip39"
import { mnemonicToAddressCached } from "./solana.js"
import { parsePuzzleSource, PUZZLE_SOURCE_SQLITE } from "./puzzle-vault-env.js"

const EVAL_CACHE_MAX = Math.min(
  Math.max(Number(process.env.EVAL_LRU_MAX) || 5000, 100),
  100_000
)

const evalLru = new LRUCache({ max: EVAL_CACHE_MAX })

/** Uniform shuffle (Fisher–Yates). */
export function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function normalizePhrase(p) {
  return String(p ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
}

/** Public commitment only — not used for win validation. */
export function hashMnemonic(m) {
  const n = normalizePhrase(m)
  return crypto.createHash("sha256").update(n).digest("hex")
}

export function parseConstraintsJson(raw) {
  if (!raw || !String(raw).trim()) return { fixed_positions: {} }
  let j
  try {
    j = JSON.parse(String(raw).trim())
  } catch {
    throw new Error("constraints JSON: invalid JSON")
  }
  const fp = j.fixed_positions ?? {}
  const fixed_positions = {}
  for (const [k, v] of Object.entries(fp)) {
    fixed_positions[Number(k)] = String(v).trim().toLowerCase()
  }
  return { fixed_positions }
}

function parseConstraints() {
  return parseConstraintsJson(process.env.PUZZLE_CONSTRAINTS_JSON)
}

function computeDifficulty(wordCount, constraints) {
  const fixed = Object.keys(constraints.fixed_positions || {}).length
  if (wordCount <= 9) return "easy"
  if (fixed === 0 && wordCount === 12) return "hard"
  if (fixed >= 1 && fixed <= 3) return "easy"
  if (fixed >= 4 && fixed <= 8) return "medium"
  return "hard"
}

export function loadPuzzleFromEnv() {
  const target_address = process.env.TARGET_ADDRESS?.trim()
  const solution_hash = process.env.SOLUTION_HASH?.trim()
  const wordsRaw = process.env.PUZZLE_WORDS?.trim()

  if (!target_address || !solution_hash || !wordsRaw) {
    throw new Error(
      "Missing env: TARGET_ADDRESS, SOLUTION_HASH, PUZZLE_WORDS (see .env.example)"
    )
  }

  const words = wordsRaw
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)

  if (words.length !== 12) {
    throw new Error("PUZZLE_WORDS must contain exactly 12 comma-separated words")
  }

  const id = process.env.PUZZLE_ID?.trim() || "001"
  const constraints = parseConstraints()
  const round_id = process.env.ROUND_ID?.trim() || "default"
  const difficulty =
    process.env.PUZZLE_DIFFICULTY?.trim().toLowerCase() ||
    computeDifficulty(words.length, constraints)

  return {
    id,
    round_id,
    difficulty,
    words,
    solution_hash,
    target_address,
    constraints,
  }
}

/** Mutable in-process puzzle; filled from env or from SQLite vault row. */
export const PUZZLE = {
  id: "001",
  round_id: "default",
  difficulty: "easy",
  words: [],
  solution_hash: "",
  target_address: "",
  constraints: { fixed_positions: {} },
}

if (parsePuzzleSource() !== PUZZLE_SOURCE_SQLITE) {
  Object.assign(PUZZLE, loadPuzzleFromEnv())
}

/**
 * Apply active vault row to `PUZZLE` (must match `puzzles` table shape).
 * @param {object} row - DB row with public_id, target_address, solution_hash, puzzle_words_csv, constraints_json?, round_id?, difficulty?
 */
export function applyPuzzleRowFromVault(row) {
  const wordsRaw = row.puzzle_words_csv?.trim()
  if (!wordsRaw) {
    throw new Error("vault row missing puzzle_words_csv")
  }
  const words = wordsRaw
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
  if (words.length !== 12) {
    throw new Error("vault puzzle_words_csv must contain exactly 12 comma-separated words")
  }
  const constraints = parseConstraintsJson(row.constraints_json || "{}")
  const difficulty =
    (row.difficulty && String(row.difficulty).trim().toLowerCase()) ||
    computeDifficulty(words.length, constraints)
  Object.assign(PUZZLE, {
    id: String(row.public_id).trim(),
    round_id: row.round_id?.trim() || "default",
    difficulty,
    words,
    solution_hash: String(row.solution_hash).trim(),
    target_address: String(row.target_address).trim(),
    constraints,
  })
}

/**
 * Parse signed claim messages.
 * - `solve:{round_id}:{id}:{ts}:{nonce}:{mnemonic_hash}` — round + binding (6 parts).
 * - `solve:{id}:{ts}:{nonce}:{mnemonic_hash}` — binds signature to exact mnemonic (sha256 hex).
 * - `solve:{id}:{ts}:{nonce}` — nonce only (no mnemonic binding; weaker).
 * - `solve:{id}:{ts}` — timestamp only (replay possible in window).
 * - `solve:{id}` — legacy if `allowLegacy`.
 */
export function parseSolveMessage(
  message,
  puzzleId,
  allowLegacy,
  requireNonce,
  requireMnemonicBinding = false,
  requireRoundInMessage = false
) {
  if (typeof message !== "string") return null
  const parts = message.split(":")
  if (parts[0] !== "solve") return null

  if (parts.length === 6) {
    const roundId = parts[1]
    const id = parts[2]
    const ts = Number(parts[3])
    const nonce = parts[4]
    const mnemonicHash = parts[5]
    if (id !== puzzleId || !Number.isFinite(ts) || !nonce || nonce.length > 256) {
      return null
    }
    if (!/^[0-9a-f]{64}$/i.test(mnemonicHash)) return null
    return {
      mode: "timestamp_nonce_binding",
      puzzleId: id,
      roundId,
      ts,
      nonce,
      mnemonicHash: mnemonicHash.toLowerCase(),
    }
  }

  if (requireRoundInMessage) return null

  if (parts.length === 5) {
    const id = parts[1]
    const ts = Number(parts[2])
    const nonce = parts[3]
    const mnemonicHash = parts[4]
    if (id !== puzzleId || !Number.isFinite(ts) || !nonce || nonce.length > 256) {
      return null
    }
    if (!/^[0-9a-f]{64}$/i.test(mnemonicHash)) return null
    return {
      mode: "timestamp_nonce_binding",
      puzzleId: id,
      ts,
      nonce,
      mnemonicHash: mnemonicHash.toLowerCase(),
    }
  }

  if (requireMnemonicBinding) return null

  if (parts.length === 4) {
    const id = parts[1]
    const ts = Number(parts[2])
    const nonce = parts[3]
    if (id !== puzzleId || !Number.isFinite(ts) || !nonce || nonce.length > 256) {
      return null
    }
    return { mode: "timestamp_nonce", puzzleId: id, ts, nonce }
  }

  if (parts.length === 3) {
    if (requireNonce) return null
    const id = parts[1]
    const ts = Number(parts[2])
    if (id !== puzzleId || !Number.isFinite(ts)) return null
    return { mode: "timestamp", puzzleId: id, ts }
  }

  if (allowLegacy && parts.length === 2) {
    const id = parts[1]
    if (id !== puzzleId) return null
    return { mode: "legacy", puzzleId: id }
  }
  return null
}

function checkFixedPositions(wordArr) {
  const { fixed_positions } = PUZZLE.constraints
  for (const [idxStr, expected] of Object.entries(fixed_positions)) {
    const idx = Number(idxStr)
    if (wordArr[idx] !== expected) return false
  }
  return true
}

/**
 * Win = valid BIP39 + constraints + derived Solana address === TARGET_ADDRESS.
 */
export function evaluateMnemonic(raw) {
  const phrase = normalizePhrase(raw)
  if (!phrase) {
    return {
      valid_checksum: false,
      matches_target: false,
      rejected_by_constraints: false,
      passed_constraints: false,
    }
  }

  const wordArr = phrase.split(" ")
  if (wordArr.length !== 12) {
    return {
      valid_checksum: false,
      matches_target: false,
      rejected_by_constraints: false,
      passed_constraints: false,
    }
  }

  if (!checkFixedPositions(wordArr)) {
    return {
      valid_checksum: null,
      matches_target: false,
      rejected_by_constraints: true,
      passed_constraints: false,
    }
  }

  if (!bip39.validateMnemonic(phrase)) {
    return {
      valid_checksum: false,
      matches_target: false,
      rejected_by_constraints: false,
      passed_constraints: true,
    }
  }

  const addr = mnemonicToAddressCached(phrase)
  const matches_target = addr === PUZZLE.target_address

  return {
    valid_checksum: true,
    matches_target,
    rejected_by_constraints: false,
    passed_constraints: true,
    phrase,
  }
}

/**
 * LRU by mnemonic hash: skips BIP39 + seed work on repeat phrases.
 * Stores enough to reconstruct `evaluateMnemonic` output (no phrase in cache value).
 */
export function evaluateMnemonicCached(raw) {
  const phrase = normalizePhrase(raw)
  const h = hashMnemonic(raw)
  const hit = evalLru.get(h)
  if (hit) {
    return {
      valid_checksum: hit.valid_checksum,
      matches_target: hit.matches_target,
      rejected_by_constraints: hit.rejected_by_constraints,
      passed_constraints: hit.passed_constraints,
      phrase: hit.valid_checksum === true ? phrase : undefined,
    }
  }

  const ev = evaluateMnemonic(raw)
  if (!ev.rejected_by_constraints) {
    evalLru.set(h, {
      valid_checksum: ev.valid_checksum,
      matches_target: ev.matches_target,
      rejected_by_constraints: ev.rejected_by_constraints,
      passed_constraints: ev.passed_constraints,
      address:
        ev.valid_checksum === true
          ? mnemonicToAddressCached(phrase)
          : undefined,
    })
  }
  return ev
}

/** JSON shape for /validate, /validate_batch. */
export function validationJson(ev) {
  if (ev.rejected_by_constraints) {
    return {
      valid_checksum: null,
      matches_target: false,
      rejected_by_constraints: true,
    }
  }
  return {
    valid_checksum: ev.valid_checksum === true,
    matches_target: !!ev.matches_target,
    rejected_by_constraints: false,
  }
}
