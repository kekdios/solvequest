const API = ""

const MY_WALLET =
  typeof localStorage !== "undefined"
    ? localStorage.getItem("solvequest_wallet") || "user_ui"
    : "user_ui"

const PLAYER_ROSTER_KEY = "solvequest_player_roster_v1"
const LEGACY_RUNNER_ROSTER_KEY = "solvequest_runner_roster_v1"
/** Display names: letter/digit first, then letters, numbers, space, - _ ' */
const PLAYER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9 _'\-]{0,31}$/

function escapeHtml(s) {
  if (s == null) return ""
  const d = document.createElement("div")
  d.textContent = String(s)
  return d.innerHTML
}

function loadPlayerRoster() {
  try {
    let raw = localStorage.getItem(PLAYER_ROSTER_KEY)
    if (raw == null || raw === "") {
      raw = localStorage.getItem(LEGACY_RUNNER_ROSTER_KEY)
      if (raw) {
        localStorage.setItem(PLAYER_ROSTER_KEY, raw)
        localStorage.removeItem(LEGACY_RUNNER_ROSTER_KEY)
      }
    }
    if (!raw) return []
    const j = JSON.parse(raw)
    return Array.isArray(j) ? j : []
  } catch {
    return []
  }
}

function savePlayerRoster(entries) {
  localStorage.setItem(PLAYER_ROSTER_KEY, JSON.stringify(entries))
}

function getPlayerLabel(address) {
  if (address == null || address === "") return null
  const a = String(address).trim()
  const hit = loadPlayerRoster().find((r) => r.address === a)
  return hit?.name ?? null
}

function validatePlayerName(raw) {
  const t = String(raw ?? "").trim()
  if (t.length < 1) return { ok: false, error: "Enter a display name." }
  if (t.length > 32) return { ok: false, error: "Name max 32 characters." }
  if (!PLAYER_NAME_RE.test(t)) return { ok: false, error: "Name uses invalid characters." }
  return { ok: true, name: t }
}

function validatePlayerAddress(raw) {
  const t = String(raw ?? "").trim()
  if (t.length < 2) return { ok: false, error: "Enter an address or wallet id." }
  if (t.length > 128) return { ok: false, error: "Address too long." }
  return { ok: true, address: t }
}

function addOrUpdatePlayer(addressRaw, nameRaw) {
  const va = validatePlayerAddress(addressRaw)
  if (!va.ok) return va
  const vn = validatePlayerName(nameRaw)
  if (!vn.ok) return vn
  const roster = loadPlayerRoster()
  const addr = va.address
  const nameLower = vn.name.toLowerCase()
  const idxAddr = roster.findIndex((r) => r.address === addr)
  const idxName = roster.findIndex((r) => r.name.toLowerCase() === nameLower)
  if (idxName !== -1 && roster[idxName].address !== addr) {
    return { ok: false, error: "That name is already used for another address." }
  }
  if (idxAddr !== -1) {
    roster[idxAddr].name = vn.name
  } else {
    roster.push({ address: addr, name: vn.name })
  }
  savePlayerRoster(roster)
  return { ok: true }
}

function removePlayer(address) {
  const a = String(address ?? "").trim()
  savePlayerRoster(loadPlayerRoster().filter((r) => r.address !== a))
}

function setPlayerFormError(msg) {
  const el = document.getElementById("player-form-error")
  if (!el) return
  if (!msg) {
    el.hidden = true
    el.textContent = ""
    return
  }
  el.hidden = false
  el.textContent = msg
}

function renderPlayerSavedList() {
  const ul = document.getElementById("player-saved-list")
  if (!ul) return
  ul.replaceChildren()
  const roster = loadPlayerRoster()
  if (roster.length === 0) {
    const li = document.createElement("li")
    li.className = "player-saved-empty"
    li.style.color = "var(--muted)"
    li.style.fontSize = "0.82rem"
    li.textContent = "No saved players yet."
    ul.appendChild(li)
    return
  }
  roster.forEach((r) => {
    const li = document.createElement("li")
    const meta = document.createElement("div")
    meta.className = "player-saved-meta"
    const nm = document.createElement("span")
    nm.className = "player-saved-name"
    nm.textContent = r.name
    const ad = document.createElement("span")
    ad.className = "player-saved-addr"
    ad.textContent = r.address
    meta.appendChild(nm)
    meta.appendChild(ad)
    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = "player-saved-remove"
    btn.textContent = "Remove"
    btn.addEventListener("click", () => {
      removePlayer(r.address)
      renderPlayerSavedList()
      loadLeaderboard()
    })
    li.appendChild(meta)
    li.appendChild(btn)
    ul.appendChild(li)
  })
}

let countdownTimer = null
let lastTopSig = ""

function fmtShortPubkey(pk) {
  if (!pk || pk.length < 12) return pk || "—"
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`
}

async function loadPuzzle() {
  const res = await fetch(`${API}/puzzle`, { cache: "no-store" })
  if (!res.ok) {
    uiNotice(`Failed to load puzzle: ${res.status}`)
    return
  }
  const data = await res.json()
  /** Authoritative: API can keep round_active/phase "active" after a win — UI must not show "open" then. */
  const isSolved = data.solved === true

  document.getElementById("puzzle").innerText = data.words.join(" ")
  document.getElementById("commitment-hash").textContent = data.solution_hash ?? "—"
  document.getElementById("commitment-addr").textContent = data.target_address ?? "—"

  const diff = data.difficulty ?? "—"
  document.getElementById("badge-difficulty").textContent =
    typeof diff === "string" ? diff.toUpperCase() : String(diff)

  const rid = data.round_id ?? "—"
  document.getElementById("badge-round").textContent = `round ${rid}`

  const statusTicker = document.getElementById("ticker-puzzle-status")
  const statusWrap = document.getElementById("ticker-puzzle-status-wrap")
  const badgeOpen = document.getElementById("badge-open")
  if (statusTicker) {
    statusTicker.textContent = isSolved ? "SOLVED" : "NOT SOLVED"
    statusTicker.classList.toggle("is-solved", isSolved)
    statusTicker.classList.toggle("is-open", !isSolved)
  }
  if (statusWrap) {
    statusWrap.classList.toggle("is-solved", isSolved)
    statusWrap.classList.toggle("is-open", !isSolved)
  }
  if (badgeOpen) {
    badgeOpen.hidden = isSolved
    badgeOpen.textContent = "NOT SOLVED"
  }

  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
  const endMs = data.round_end_ms
  const phase = data.round_phase || "active"
  const active = data.round_active !== false

  function tickCountdown() {
    const el = document.getElementById("countdown")
    if (isSolved) {
      el.textContent = "solved"
      return
    }
    if (phase === "settled") {
      el.textContent = "settled"
      return
    }
    if (phase === "ended" && endMs) {
      el.textContent = "ended"
      return
    }
    if (!endMs || !active) {
      el.textContent = endMs && !active ? "ended" : "open"
      return
    }
    const left = Math.max(0, endMs - Date.now())
    if (left <= 0) {
      el.textContent = "ended"
      return
    }
    const s = Math.floor(left / 1000)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    el.textContent =
      h > 0
        ? `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`
        : `${m}m ${String(sec).padStart(2, "0")}s`
  }
  tickCountdown()
  if (!isSolved && endMs && active && phase === "active") {
    countdownTimer = setInterval(tickCountdown, 1000)
  }

  const fp = data.constraints?.fixed_positions
  const sec = document.getElementById("constraints-section")
  const txt = document.getElementById("constraints-text")
  const envLine = document.getElementById("constraints-env-line")
  if (fp && Object.keys(fp).length > 0) {
    const parts = Object.entries(fp)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([i, w]) => `position ${Number(i) + 1} = ${w}`)
    txt.textContent = `Fixed words: ${parts.join("; ")}`
    const sorted = {}
    for (const k of Object.keys(fp).sort((a, b) => Number(a) - Number(b))) {
      sorted[k] = String(fp[k]).trim().toLowerCase()
    }
    envLine.textContent = `PUZZLE_CONSTRAINTS_JSON=${JSON.stringify({
      fixed_positions: sorted,
    })}`
    sec.hidden = false
  } else {
    txt.textContent = ""
    envLine.textContent = ""
    sec.hidden = true
  }

  const solvedPanel = document.getElementById("puzzle-solved-panel")
  const solvedDetail = document.getElementById("puzzle-solved-detail")
  const solvedBadge = document.getElementById("badge-solved")
  const puzzleEl = document.getElementById("puzzle")
  if (isSolved) {
    if (solvedPanel) solvedPanel.hidden = false
    if (solvedBadge) solvedBadge.hidden = false
    if (solvedDetail) {
      const wRaw = data.winner
      const w = wRaw != null && String(wRaw).trim() !== "" ? String(wRaw).trim() : ""
      if (w) {
        const label = getPlayerLabel(w)
        solvedDetail.textContent = label ? `Winner: ${label} (${w})` : `Winner: ${w}`
      } else {
        solvedDetail.textContent = "Puzzle solved."
      }
    }
    if (puzzleEl) puzzleEl.classList.add("puzzle-words--solved")
  } else {
    if (solvedPanel) solvedPanel.hidden = true
    if (solvedBadge) solvedBadge.hidden = true
    if (solvedDetail) solvedDetail.textContent = ""
    if (puzzleEl) puzzleEl.classList.remove("puzzle-words--solved")
  }
}

async function loadStats() {
  try {
    const res = await fetch(`${API}/stats`, { cache: "no-store" })
    if (!res.ok) return
    const s = await res.json()
    const aps = s.attempts_per_sec
    document.getElementById("stat-aps").textContent =
      typeof aps === "number" ? aps.toFixed(2) : "—"
    document.getElementById("stat-agents").textContent =
      s.active_agents != null ? String(s.active_agents) : "—"
    document.getElementById("stat-total").textContent =
      s.attempts_total != null ? String(s.attempts_total) : "—"
    const vr = s.valid_rate
    document.getElementById("stat-valid-rate").textContent =
      typeof vr === "number" ? vr.toFixed(4) : "—"
  } catch {
    /* ignore */
  }
}

async function loadVersion() {
  try {
    const res = await fetch(`${API}/version`, { cache: "no-store" })
    if (!res.ok) return
    const data = await res.json()
    const v = data?.version
    const el = document.getElementById("app-version")
    if (el && typeof v === "string" && v) {
      el.textContent = `SolveQuest v${v}`
    }
  } catch {
    /* ignore */
  }
}

async function loadPrizeBalances() {
  try {
    const res = await fetch(`${API}/prize/balances`)
    if (!res.ok) return
    const p = await res.json()
    const token =
      Number(p.prize_token_balance ?? p.usdc_balance)
    const sol = Number(p.sol_balance)
    document.getElementById("prize-usdc-text").textContent = `SAUSD ${Number.isFinite(token) ? token.toFixed(2) : "—"}`
    document.getElementById("prize-sol").textContent = `SOL ${Number.isFinite(sol) ? sol.toFixed(4) : "—"}`
    document.getElementById("reward-usdc-text").textContent = Number.isFinite(token)
      ? `${token.toLocaleString(undefined, { maximumFractionDigits: 2 })} SAUSD`
      : "— SAUSD"
  } catch {
    /* ignore */
  }
}

function uiNotice(msg) {
  logSse(`[UI] ${msg}`)
}

function renderYouVs(self) {
  const el = document.getElementById("you-vs-top")
  if (!self) {
    el.innerHTML = ""
    return
  }
  const pk = self.pubkey ?? MY_WALLET
  const displayName = getPlayerLabel(pk)
  const rank = self.rank != null ? `#${self.rank}` : "—"
  const ls = self.leader_score != null ? self.leader_score : self.gap_to_leader + self.score
  const nickLine = displayName
    ? `<div class="you-vs-nick">${escapeHtml(displayName)} <span class="mono you-vs-pk">${escapeHtml(fmtShortPubkey(pk))}</span></div>`
    : ""
  el.innerHTML = `${nickLine}<div class="you-vs-grid"><span>Your score</span><strong class="mono">${Number(self.score).toFixed(self.score % 1 ? 2 : 0)}</strong><span>Leader</span><strong class="mono">${Number(ls).toFixed(2)}</strong><span>Gap</span><strong class="mono accent">${Number(self.gap_to_leader).toFixed(2)}</strong><span>Rank</span><strong class="mono">${rank}</strong></div>`
}

async function loadLeaderboard() {
  try {
    const res = await fetch(
      `${API}/leaderboard?limit=10&wallet=${encodeURIComponent(MY_WALLET)}`,
      { cache: "no-store" }
    )
    if (!res.ok) return
    const data = await res.json()
    const rows = data.top ?? data
    const ol = document.getElementById("leaderboard-list")
    ol.replaceChildren()
    if (data.self) renderYouVs(data.self)
    if (!Array.isArray(rows) || rows.length === 0) {
      const li = document.createElement("li")
      li.className = "lb-empty"
      li.textContent = "No scores yet"
      ol.appendChild(li)
      return
    }
    const sig = JSON.stringify(rows.map((r) => [r.pubkey, r.score]))
    if (sig !== lastTopSig) {
      ol.classList.add("lb-flash")
      setTimeout(() => ol.classList.remove("lb-flash"), 400)
      lastTopSig = sig
    }
    rows.forEach((row, i) => {
      const li = document.createElement("li")
      const pk = row.pubkey ?? row[0]
      const score = row.score ?? row[1]
      const isYou = pk === MY_WALLET
      li.className = isYou ? "lb-you" : ""
      const short = fmtShortPubkey(pk)
      const label = getPlayerLabel(pk)
      const mid = label
        ? `<span class="lb-id"><span class="lb-name">${escapeHtml(label)}</span> <span class="lb-pk-short mono">${escapeHtml(short)}</span></span>`
        : `<span class="mono">${escapeHtml(short)}</span>`
      li.innerHTML = `<span class="lb-rank">${i + 1}</span><span class="lb-pk">${mid}</span><span class="lb-score mono">${Number(score).toFixed(score % 1 ? 2 : 0)}</span>`
      ol.appendChild(li)
    })
  } catch {
    /* ignore */
  }
}

function logSse(msg) {
  const div = document.createElement("div")
  div.className = "log-line sse"
  div.textContent = msg
  document.getElementById("sse-logs").prepend(div)
}

function connectEvents() {
  const es = new EventSource(`${API}/events`)
  es.onmessage = (ev) => {
    try {
      const payload = JSON.parse(ev.data)
      logSse(JSON.stringify(payload))
      const t = payload.type
      if (
        t === "claim" ||
        t === "submit" ||
        t === "win" ||
        t === "leaderboard_update" ||
        t === "attempt"
      ) {
        loadStats()
        loadLeaderboard()
      }
      if (
        t === "win" ||
        t === "puzzle_cleared" ||
        (t === "submit" && (payload.status === "win" || payload.status === "already_solved"))
      ) {
        loadPuzzle()
      }
      if (t === "round_end" || t === "round_settled" || t === "round_archived" || t === "round_rotated") {
        loadPuzzle()
        loadStats()
        loadPrizeBalances()
        loadLeaderboard()
      }
    } catch {
      logSse(ev.data)
    }
  }
  es.onerror = () => {
    logSse("[SSE] connection error — retrying in browser…")
  }
}

const playerDlg = document.getElementById("player-names-dialog")
const playerOpen = document.getElementById("player-names-open")
const playerForm = document.getElementById("player-form")
if (playerOpen && playerDlg && playerForm) {
  playerOpen.addEventListener("click", () => {
    setPlayerFormError("")
    renderPlayerSavedList()
    playerDlg.showModal()
  })
  document.getElementById("player-btn-close")?.addEventListener("click", () => playerDlg.close())
  playerForm.addEventListener("submit", (e) => {
    e.preventDefault()
    const addrEl = document.getElementById("player-input-address")
    const nameEl = document.getElementById("player-input-name")
    const r = addOrUpdatePlayer(addrEl?.value, nameEl?.value)
    if (!r.ok) {
      setPlayerFormError(r.error)
      return
    }
    setPlayerFormError("")
    if (addrEl) addrEl.value = ""
    if (nameEl) nameEl.value = ""
    renderPlayerSavedList()
    loadLeaderboard()
  })
}

connectEvents()
loadVersion()
loadPuzzle()
loadStats()
loadPrizeBalances()
loadLeaderboard()
setInterval(loadStats, 1500)
setInterval(loadPrizeBalances, 10000)
setInterval(loadLeaderboard, 8000)
setInterval(loadPuzzle, 5000)
