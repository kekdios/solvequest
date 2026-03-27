const API = ""

const MY_WALLET =
  typeof localStorage !== "undefined"
    ? localStorage.getItem("solvequest_wallet") || "user_ui"
    : "user_ui"

let countdownTimer = null
let lastTopSig = ""
let workerRunning = false

function fmtShortPubkey(pk) {
  if (!pk || pk.length < 12) return pk || "—"
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`
}

async function loadPuzzle() {
  const res = await fetch(`${API}/puzzle`)
  if (!res.ok) {
    log(`Failed to load puzzle: ${res.status}`)
    return
  }
  const data = await res.json()
  document.getElementById("puzzle").innerText = data.words.join(" ")
  document.getElementById("commitment-hash").textContent = data.solution_hash ?? "—"
  document.getElementById("commitment-addr").textContent = data.target_address ?? "—"

  const diff = data.difficulty ?? "—"
  document.getElementById("badge-difficulty").textContent =
    typeof diff === "string" ? diff.toUpperCase() : String(diff)

  const rid = data.round_id ?? "—"
  document.getElementById("badge-round").textContent = `round ${rid}`

  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
  const endMs = data.round_end_ms
  const phase = data.round_phase || "active"
  const active = data.round_active !== false

  function tickCountdown() {
    const el = document.getElementById("countdown")
    if (phase === "settled") {
      el.textContent = "settled"
      return
    }
    if (phase === "grace" && endMs) {
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
  if (endMs && active && phase === "active") {
    countdownTimer = setInterval(tickCountdown, 1000)
  }

  const fp = data.constraints?.fixed_positions
  const sec = document.getElementById("constraints-section")
  const txt = document.getElementById("constraints-text")
  if (fp && Object.keys(fp).length > 0) {
    const parts = Object.entries(fp)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([i, w]) => `position ${Number(i) + 1} = ${w}`)
    txt.textContent = `Fixed words: ${parts.join("; ")}`
    sec.hidden = false
  } else {
    sec.hidden = true
  }
}

async function loadStats() {
  try {
    const res = await fetch(`${API}/stats`)
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

function renderWorkerStatus(data) {
  const statusEl = document.getElementById("worker-status")
  const btnEl = document.getElementById("worker-toggle-btn")
  workerRunning = !!data?.running
  statusEl.textContent = workerRunning ? "running" : "stopped"
  statusEl.classList.toggle("is-running", workerRunning)
  statusEl.classList.toggle("is-stopped", !workerRunning)
  btnEl.textContent = workerRunning ? "Stop" : "Start"
}

async function loadWorkerStatus() {
  try {
    const res = await fetch(`${API}/worker/status`)
    if (!res.ok) return
    const data = await res.json()
    renderWorkerStatus(data)
  } catch {
    /* ignore */
  }
}

async function toggleWorker() {
  const route = workerRunning ? "/worker/stop" : "/worker/start"
  const btnEl = document.getElementById("worker-toggle-btn")
  const prevText = btnEl.textContent
  btnEl.disabled = true
  btnEl.textContent = workerRunning ? "Stopping..." : "Starting..."
  try {
    const res = await fetch(`${API}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })
    if (!res.ok) {
      log(`Worker toggle failed: ${res.status}`)
      return
    }
    const data = await res.json()
    renderWorkerStatus(data)
  } catch {
    log("Worker toggle failed")
  } finally {
    btnEl.disabled = false
    if (btnEl.textContent === "Starting..." || btnEl.textContent === "Stopping...") {
      btnEl.textContent = prevText
    }
    loadWorkerStatus()
  }
}

function renderYouVs(self) {
  const el = document.getElementById("you-vs-top")
  if (!self) {
    el.innerHTML = ""
    return
  }
  const rank = self.rank != null ? `#${self.rank}` : "—"
  const ls = self.leader_score != null ? self.leader_score : self.gap_to_leader + self.score
  el.innerHTML = `<div class="you-vs-grid"><span>Your score</span><strong class="mono">${Number(self.score).toFixed(self.score % 1 ? 2 : 0)}</strong><span>Leader</span><strong class="mono">${Number(ls).toFixed(2)}</strong><span>Gap</span><strong class="mono accent">${Number(self.gap_to_leader).toFixed(2)}</strong><span>Rank</span><strong class="mono">${rank}</strong></div>`
}

async function loadLeaderboard() {
  try {
    const res = await fetch(
      `${API}/leaderboard?limit=10&wallet=${encodeURIComponent(MY_WALLET)}`
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
      li.innerHTML = `<span class="lb-rank">${i + 1}</span><span class="lb-pk mono">${fmtShortPubkey(pk)}</span><span class="lb-score mono">${Number(score).toFixed(score % 1 ? 2 : 0)}</span>`
      ol.appendChild(li)
    })
  } catch {
    /* ignore */
  }
}

async function submit() {
  const phrase = document.getElementById("input").value
  const res = await fetch(`${API}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phrase,
      wallet: MY_WALLET,
    }),
  })
  const data = await res.json()
  log(JSON.stringify(data))
  loadLeaderboard()
  loadPuzzle()
}

function log(msg) {
  const div = document.createElement("div")
  div.className = "log-line"
  div.textContent = msg
  document.getElementById("logs").prepend(div)
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
      if (t === "round_end" || t === "round_settled") {
        loadPuzzle()
        loadStats()
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

document.getElementById("submit-btn").addEventListener("click", submit)
document.getElementById("worker-toggle-btn").addEventListener("click", toggleWorker)
document.getElementById("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submit()
})

connectEvents()
loadPuzzle()
loadStats()
loadWorkerStatus()
loadLeaderboard()
setInterval(loadStats, 1500)
setInterval(loadWorkerStatus, 2500)
setInterval(loadLeaderboard, 8000)
setInterval(loadPuzzle, 5000)
