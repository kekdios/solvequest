const API = ""

function escapeHtml(s) {
  if (s == null) return ""
  const d = document.createElement("div")
  d.textContent = String(s)
  return d.innerHTML
}

/** @type {string} */
let currentPuzzlePublicId = ""

function fmtShortPubkey(pk) {
  if (!pk || pk.length < 12) return pk || "—"
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`
}

/** Base58 Solana pubkey shape (explorer links only; not full cryptographic validation). */
function isLikelySolanaPubkey(s) {
  const t = String(s ?? "").trim()
  if (t.length < 32 || t.length > 44) return false
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(t)
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
    const addrText = data.target_address != null ? String(data.target_address).trim() : ""
    document.getElementById("commitment-addr").textContent = addrText || "—"
    const solscan = document.getElementById("commitment-solscan")
    if (solscan) {
      if (addrText && isLikelySolanaPubkey(addrText)) {
        solscan.href = `https://solscan.io/account/${encodeURIComponent(addrText)}`
        solscan.hidden = false
      } else {
        solscan.hidden = true
        solscan.setAttribute("href", "https://solscan.io/")
      }
    }

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
          solvedDetail.textContent = `Winner: ${w}`
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
      if (t === "submit" || t === "win") {
        loadStats()
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
setInterval(loadStats, 1500)
setInterval(loadPrizeBalances, 10000)
setInterval(loadPuzzle, 5000)
