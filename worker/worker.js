import bip39 from "bip39"

const API = process.env.SOLQUEST_API || "http://localhost:3001"
const WALLET = "agent_" + Math.floor(Math.random() * 10000)
const STRATEGY = (process.env.WORKER_STRATEGY || "random").toLowerCase()
const VERBOSE = process.env.WORKER_LOG_VERBOSE === "1"
const PROGRESS_EVERY = Number(process.env.WORKER_PROGRESS_EVERY) || 250_000

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function normalizePhrase(phrase) {
  return String(phrase ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/** Lexicographic next permutation; mutates `a`. Returns false when done. */
function nextPermutation(a) {
  let i = a.length - 2
  while (i >= 0 && a[i] >= a[i + 1]) i--
  if (i < 0) return false
  let j = a.length - 1
  while (a[j] <= a[i]) j--
  ;[a[i], a[j]] = [a[j], a[i]]
  let lo = i + 1
  let hi = a.length - 1
  while (lo < hi) {
    ;[a[lo], a[hi]] = [a[hi], a[lo]]
    lo++
    hi--
  }
  return true
}

async function postValidate(mnemonic) {
  const r = await fetch(`${API}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mnemonic }),
  })
  if (!r.ok) throw new Error(`POST /validate ${r.status}`)
  return r.json()
}

async function postSubmit(phrase) {
  const res = await fetch(`${API}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phrase,
      wallet: WALLET,
    }),
  })
  if (!res.ok) throw new Error(`POST /submit ${res.status}`)
  return res.json()
}

async function runRandom(puzzleWords) {
  const submitted = new Set()
  let wrongValid = 0

  while (true) {
    const candidate = shuffle(puzzleWords).join(" ")

    if (!bip39.validateMnemonic(candidate)) {
      await sleep(5 + Math.random() * 25)
      continue
    }

    const norm = normalizePhrase(candidate)
    if (submitted.has(norm)) {
      await sleep(5 + Math.random() * 15)
      continue
    }

    const v = await postValidate(candidate)
    if (!v.matches_target) {
      submitted.add(norm)
      if (v.valid_checksum === true) {
        wrongValid++
        if (VERBOSE || wrongValid % 25 === 0) {
          console.log("Validate:", "valid_but_wrong", `(count: ${wrongValid})`)
        }
      }
      await sleep(15 + Math.random() * 35)
      continue
    }

    submitted.add(norm)
    const result = await postSubmit(candidate)
    console.log("Submit (match):", result.status)

    if (result.status === "win") {
      console.log("WINNER:", WALLET)
      break
    }
    if (result.status === "already_solved") {
      console.log("Puzzle already solved by:", result.winner)
      break
    }

    await sleep(15 + Math.random() * 35)
  }
}

async function runExhaustive(puzzleWords) {
  const words = [...puzzleWords].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  let permutations = 0
  const seen = new Set()

  do {
    permutations++
    if (permutations % PROGRESS_EVERY === 0) {
      console.log(`Exhaustive: ${permutations.toLocaleString()} permutations checked…`)
    }

    const candidate = words.join(" ")
    if (bip39.validateMnemonic(candidate)) {
      const norm = normalizePhrase(candidate)
      if (!seen.has(norm)) {
        seen.add(norm)
        const v = await postValidate(candidate)
        if (v.matches_target) {
          const result = await postSubmit(candidate)
          console.log("Submit (match):", result.status)

          if (result.status === "win") {
            console.log("WINNER:", WALLET)
            return
          }
          if (result.status === "already_solved") {
            console.log("Puzzle already solved by:", result.winner)
            return
          }
        }
      }
    }
  } while (nextPermutation(words))

  console.log(
    "Exhaustive pass finished:",
    permutations.toLocaleString(),
    "permutations (no win)."
  )
}

async function run() {
  const res = await fetch(`${API}/puzzle`)
  if (!res.ok) throw new Error(`GET /puzzle ${res.status}`)
  const puzzle = await res.json()

  console.log(
    "Worker:",
    WALLET,
    "puzzle:",
    puzzle.id,
    "strategy:",
    STRATEGY,
    VERBOSE ? "(verbose)" : ""
  )

  if (STRATEGY === "exhaustive") {
    await runExhaustive(puzzle.words)
  } else if (STRATEGY === "random") {
    await runRandom(puzzle.words)
  } else {
    console.error(
      "Unknown WORKER_STRATEGY:",
      STRATEGY,
      "— use random or exhaustive"
    )
    process.exit(1)
  }
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
