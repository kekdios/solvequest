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

let lastTopSig = ""
/** @type {string} */
let currentPuzzlePublicId = ""

function fmtShortPubkey(pk) {
  if (!pk || pk.length < 12) return pk || "—"
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`
}

async function loadPuzzle() {
  try {
    const res = await fetch(`${API}/puzzle`, { cache: "no-store" })
    if (!res.ok) {
      uiNotice(`Failed to load puzzle: ${res.status}`)
      return
    }
    const data = await res.json()
    const isSolved = data.solved === true

    const vaultBanner = document.getElementById("vault-empty-banner")
    if (vaultBanner) {
      vaultBanner.hidden = data.vault_empty !== true
    }

    document.getElementById("puzzle").innerText = data.words.join(" ")
    document.getElementById("commitment-hash").textContent = data.solution_hash ?? "—"
    document.getElementById("commitment-addr").textContent = data.target_address ?? "—"

    const statusTicker = document.getElementById("ticker-puzzle-status")
    const statusWrap = document.getElementById("ticker-puzzle-status-wrap")
    if (statusTicker) {
      statusTicker.textContent = isSolved ? "SOLVED" : "NOT SOLVED"
      statusTicker.classList.toggle("is-solved", isSolved)
      statusTicker.classList.toggle("is-open", !isSolved)
    }
    if (statusWrap) {
      statusWrap.classList.toggle("is-solved", isSolved)
      statusWrap.classList.toggle("is-open", !isSolved)
    }

    const pid = document.getElementById("ticker-puzzle-id")
    if (pid) pid.textContent = data.id != null ? String(data.id) : "—"
    currentPuzzlePublicId = data.id != null ? String(data.id) : ""

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
    const puzzleEl = document.getElementById("puzzle")
    if (isSolved) {
      if (solvedPanel) solvedPanel.hidden = false
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
      if (solvedDetail) solvedDetail.textContent = ""
      if (puzzleEl) puzzleEl.classList.remove("puzzle-words--solved")
    }
  } finally {
    void loadPuzzleHistory()
  }
}

function fmtHistoryDate(s) {
  if (s == null || String(s).trim() === "") return "—"
  const t = Date.parse(String(s).replace(" ", "T") + (String(s).includes("Z") ? "" : ""))
  if (!Number.isFinite(t)) return String(s).slice(0, 16)
  return new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

async function loadPuzzleHistory() {
  const body = document.getElementById("puzzle-history-body")
  const hint = document.getElementById("puzzle-history-hint")
  if (!body) return
  try {
    const res = await fetch(`${API}/puzzle/recent?limit=10`, { cache: "no-store" })
    if (!res.ok) {
      body.innerHTML =
        '<p class="puzzle-history-placeholder">Could not load puzzle history.</p>'
      return
    }
    const data = await res.json()
    if (data.source === "env") {
      if (hint) {
        hint.textContent =
          "Puzzle history is stored in the SQLite vault. This server uses env-only puzzle mode."
      }
      body.innerHTML =
        '<p class="puzzle-history-placeholder">No vault history (env puzzle mode).</p>'
      return
    }
    if (hint) {
      hint.textContent =
        "Last 10 rows from the vault (new puzzle retires the previous open row). Current puzzle is highlighted."
    }
    const rows = Array.isArray(data.puzzles) ? data.puzzles : []
    if (rows.length === 0) {
      body.innerHTML = '<p class="puzzle-history-placeholder">No puzzles in the vault yet.</p>'
      return
    }
    const thead = `<thead><tr>
      <th>Id</th>
      <th>Status</th>
      <th>Winner</th>
      <th>Added</th>
    </tr></thead>`
    const tbody = document.createElement("tbody")
    for (const r of rows) {
      const tr = document.createElement("tr")
      const pub = r.public_id != null ? String(r.public_id) : "—"
      if (currentPuzzlePublicId && pub === currentPuzzlePublicId) {
        tr.classList.add("is-current")
      }
      const st = String(r.status || "")
      const stClass =
        st === "unsolved" ? "ph-status ph-status--open" : "ph-status ph-status--done"
      const w = r.winner_id != null && String(r.winner_id).trim() !== ""
        ? escapeHtml(fmtShortPubkey(String(r.winner_id).trim()))
        : "—"
      tr.innerHTML = `<td class="ph-mono ph-id">${escapeHtml(pub)}</td>
        <td><span class="${stClass}">${escapeHtml(st || "—")}</span></td>
        <td class="ph-mono">${w}</td>
        <td class="ph-mono">${escapeHtml(fmtHistoryDate(r.created_at))}</td>`
      tbody.appendChild(tr)
    }
    body.replaceChildren()
    const table = document.createElement("table")
    table.className = "puzzle-history-table"
    table.innerHTML = thead
    table.appendChild(tbody)
    body.appendChild(table)
  } catch {
    body.innerHTML =
      '<p class="puzzle-history-placeholder">Could not load puzzle history.</p>'
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
    const sausdFmt = Number.isFinite(token)
      ? Math.round(token).toLocaleString(undefined, {
          maximumFractionDigits: 0,
          minimumFractionDigits: 0,
        })
      : null
    document.getElementById("prize-usdc-text").textContent =
      sausdFmt != null ? `QUEST ${sausdFmt}` : "QUEST —"
    document.getElementById("prize-sol").textContent = `SOL ${Number.isFinite(sol) ? sol.toFixed(4) : "—"}`
    document.getElementById("reward-usdc-text").textContent =
      sausdFmt != null ? `${sausdFmt} QUEST` : "— QUEST"
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
        t === "new_puzzle" ||
        (t === "submit" && (payload.status === "win" || payload.status === "already_solved"))
      ) {
        loadPuzzle()
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

const newPuzzleDlg = document.getElementById("new-puzzle-dialog")
const newPuzzleOpen = document.getElementById("new-puzzle-open")
const newPuzzleAdminKey = document.getElementById("new-puzzle-admin-key")
const newPuzzleErr = document.getElementById("new-puzzle-error")
const newPuzzleDraftEl = document.getElementById("new-puzzle-draft")

/** @type {null | Record<string, string | null>} */
let newPuzzleDraft = null

function buildNewPuzzleCopyBundleText(draft) {
  if (!draft) return ""
  const m = String(draft.mnemonic ?? "").trim()
  const pid = String(draft.public_id ?? "").trim()
  const ta = String(draft.target_address ?? "").trim()
  const h = String(draft.solution_hash ?? "").trim()
  const w = String(draft.puzzle_words ?? "").trim()
  return [
    `Mnemonic: ${m}`,
    "",
    `Public id: ${pid}`,
    "",
    `Target address: ${ta}`,
    "",
    `Solution hash: ${h}`,
    "",
    `12 words (CSV): ${w}`,
  ].join("\n")
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement("textarea")
      ta.value = text
      ta.setAttribute("readonly", "")
      ta.style.position = "fixed"
      ta.style.left = "-9999px"
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand("copy")
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

function flashNewPuzzleCopyFeedback(ok) {
  const el = document.getElementById("new-puzzle-copy-feedback")
  if (!el) return
  el.hidden = false
  el.textContent = ok ? "Copied to clipboard" : "Copy failed — select fields above manually"
  el.classList.toggle("is-error", !ok)
  setTimeout(() => {
    el.hidden = true
    el.textContent = ""
    el.classList.remove("is-error")
  }, 2400)
}

async function copyNewPuzzleDraftBundle() {
  const d = newPuzzleDraft
  if (!d) {
    setNewPuzzleError("Generate a draft first.")
    return
  }
  const m = String(d.mnemonic ?? "").trim()
  const pid = String(d.public_id ?? "").trim()
  const ta = String(d.target_address ?? "").trim()
  const h = String(d.solution_hash ?? "").trim()
  const w = String(d.puzzle_words ?? "").trim()
  if (!m || !pid || !ta || !h || !w) {
    setNewPuzzleError("Draft is incomplete — regenerate.")
    return
  }
  setNewPuzzleError("")
  const text = buildNewPuzzleCopyBundleText(d)
  const ok = await copyTextToClipboard(text)
  flashNewPuzzleCopyFeedback(ok)
}

function resetNewPuzzleDialog() {
  newPuzzleDraft = null
  newPuzzleDraftEl?.setAttribute("hidden", "")
  if (newPuzzleAdminKey) newPuzzleAdminKey.value = ""
  const fb = document.getElementById("new-puzzle-copy-feedback")
  if (fb) {
    fb.hidden = true
    fb.textContent = ""
    fb.classList.remove("is-error")
  }
  const preIds = [
    "new-puzzle-show-mnemonic",
    "new-puzzle-show-public-id",
    "new-puzzle-show-target",
    "new-puzzle-show-hash",
    "new-puzzle-show-words",
    "new-puzzle-show-constraints",
  ]
  for (const id of preIds) {
    const el = document.getElementById(id)
    if (el) el.textContent = ""
  }
  if (newPuzzleErr) {
    newPuzzleErr.hidden = true
    newPuzzleErr.textContent = ""
  }
}

function setNewPuzzleError(msg) {
  if (!newPuzzleErr) return
  newPuzzleErr.textContent = msg
  newPuzzleErr.hidden = !msg
}

function showNewPuzzleDraft(draft) {
  const fb = document.getElementById("new-puzzle-copy-feedback")
  if (fb) {
    fb.hidden = true
    fb.textContent = ""
    fb.classList.remove("is-error")
  }
  newPuzzleDraft = draft
  const set = (id, text) => {
    const el = document.getElementById(id)
    if (el) el.textContent = text ?? ""
  }
  set("new-puzzle-show-mnemonic", draft.mnemonic)
  set("new-puzzle-show-public-id", draft.public_id)
  set("new-puzzle-show-target", draft.target_address)
  set("new-puzzle-show-hash", draft.solution_hash)
  set("new-puzzle-show-words", draft.puzzle_words)
  set("new-puzzle-show-constraints", draft.constraints_json ?? "")
  newPuzzleDraftEl?.removeAttribute("hidden")
}

function setNewPuzzleBusy(busy) {
  for (const id of [
    "new-puzzle-generate",
    "new-puzzle-regenerate",
    "new-puzzle-approve",
    "new-puzzle-copy-bundle",
  ]) {
    const b = document.getElementById(id)
    if (b) b.disabled = busy
  }
}

async function fetchNewPuzzleDraft() {
  if (!newPuzzleAdminKey) return
  const key = newPuzzleAdminKey.value.trim()
  setNewPuzzleError("")
  if (!key) {
    setNewPuzzleError("Enter the admin key.")
    return
  }
  setNewPuzzleBusy(true)
  try {
    const res = await fetch(`${API}/public/admin/new-puzzle-draft`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": key,
      },
      body: JSON.stringify({}),
    })
    let j = null
    try {
      j = await res.json()
    } catch {
      j = null
    }
    if (res.ok && j?.ok && j.draft) {
      showNewPuzzleDraft(j.draft)
      return
    }
    if (res.status === 401) {
      setNewPuzzleError("Wrong admin key or not allowed.")
    } else if (res.status === 503) {
      setNewPuzzleError("Admin control is not configured on this server.")
    } else if (res.status === 429) {
      setNewPuzzleError("Too many requests. Wait a minute and try again.")
    } else if (res.status === 400 && j?.error === "vault_only") {
      setNewPuzzleError(
        "Server must use PUZZLE_SOURCE=sqlite with an open vault (use CLI bootstrap first)."
      )
    } else {
      setNewPuzzleError(j?.detail || j?.error || res.statusText || `Failed (${res.status})`)
    }
  } catch {
    setNewPuzzleError("Network error — try again.")
  } finally {
    setNewPuzzleBusy(false)
  }
}

if (newPuzzleOpen && newPuzzleDlg) {
  newPuzzleOpen.addEventListener("click", () => {
    resetNewPuzzleDialog()
    newPuzzleDlg.showModal()
    newPuzzleAdminKey?.focus()
  })
  document.getElementById("new-puzzle-cancel")?.addEventListener("click", () => {
    newPuzzleDlg.close()
  })
  document.getElementById("new-puzzle-generate")?.addEventListener("click", () => {
    fetchNewPuzzleDraft()
  })
  document.getElementById("new-puzzle-regenerate")?.addEventListener("click", () => {
    newPuzzleDraftEl?.setAttribute("hidden", "")
    newPuzzleDraft = null
    fetchNewPuzzleDraft()
  })
  document.getElementById("new-puzzle-copy-bundle")?.addEventListener("click", () => {
    void copyNewPuzzleDraftBundle()
  })
  document.getElementById("new-puzzle-approve")?.addEventListener("click", async () => {
    if (!newPuzzleErr || !newPuzzleAdminKey) return
    const key = newPuzzleAdminKey.value.trim()
    const d = newPuzzleDraft
    setNewPuzzleError("")
    if (!key) {
      setNewPuzzleError("Enter the admin key.")
      return
    }
    if (!d?.public_id || !d.target_address || !d.solution_hash || !d.puzzle_words) {
      setNewPuzzleError("Generate a draft first.")
      return
    }
    const body = {
      public_id: d.public_id,
      target_address: d.target_address,
      solution_hash: String(d.solution_hash).toLowerCase(),
      puzzle_words: d.puzzle_words,
    }
    if (d.constraints_json && String(d.constraints_json).trim()) {
      body.constraints_json = d.constraints_json
    }
    if (d.difficulty && String(d.difficulty).trim()) {
      body.difficulty = String(d.difficulty).trim().toLowerCase()
    }
    const approveBtn = document.getElementById("new-puzzle-approve")
    setNewPuzzleBusy(true)
    try {
      const res = await fetch(`${API}/public/admin/new-puzzle`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": key,
        },
        body: JSON.stringify(body),
      })
      newPuzzleAdminKey.value = ""
      let j = null
      try {
        j = await res.json()
      } catch {
        j = null
      }
      if (res.ok && j?.ok) {
        newPuzzleDlg.close()
        resetNewPuzzleDialog()
        await loadPuzzle()
        await loadPrizeBalances()
        let note = `New puzzle live: ${j.puzzle_id ?? ""}`
        if (j.quest_fund_tx) note += ` · QUEST tx ${j.quest_fund_tx.slice(0, 12)}…`
        if (j.quest_fund_error) note += ` · QUEST fund failed: ${j.quest_fund_error}`
        uiNotice(note)
        return
      }
      if (res.status === 401) {
        setNewPuzzleError("Wrong admin key or not allowed.")
      } else if (res.status === 503) {
        setNewPuzzleError("Admin control is not configured on this server.")
      } else if (res.status === 429) {
        setNewPuzzleError("Too many attempts. Wait a minute and try again.")
      } else if (res.status === 400 && j?.error === "vault_only") {
        setNewPuzzleError(
          "Server must use PUZZLE_SOURCE=sqlite with an open vault (use CLI bootstrap first)."
        )
      } else if (res.status === 409) {
        setNewPuzzleError(j?.detail || "That public_id already exists — regenerate a new draft.")
      } else {
        setNewPuzzleError(j?.detail || j?.error || res.statusText || `Failed (${res.status})`)
      }
    } catch {
      setNewPuzzleError("Network error — try again.")
    } finally {
      setNewPuzzleBusy(false)
    }
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
