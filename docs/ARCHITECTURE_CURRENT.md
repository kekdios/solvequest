# SolveQuest Canonical Architecture (Current)

This document is the single source of truth for the current implementation in this repository.
It reflects code in `backend/` and `frontend/` as of now.

## 1) Project Goal

SolveQuest is a live puzzle arena where participants submit 12-word BIP39 mnemonics.

A submission is evaluated against:
- checksum validity (BIP39)
- optional positional constraints
- derived Solana address match to a configured target address

The system supports:
- interactive browser gameplay (`/submit`)
- batch validation API with no API keys (`/validate_batch`; limits from env)
- realtime feed and leaderboard

## 2) System Components

### Backend (`backend/server.js`)
- Express API server (default `PORT=3001`)
- Serves static frontend from `frontend/`
- Handles validation, submits, leaderboard, stats, optional payout jobs, prize RPC reads, and SSE
- Prize line / `GET /prize/balances`: SPL mint resolved as `PRIZE_SPL_MINT` → `QUEST_MINT` → `USDC_MINT` → default SAUSD mint; balance on `TARGET_ADDRESS` + SOL (no fiat price)
- Uses Redis when `REDIS_URL` is set; otherwise falls back to in-memory store

### Puzzle / evaluation (`backend/puzzle.js`)
- Loads puzzle config from env or SQLite vault row (when `PUZZLE_SOURCE=sqlite` and an unsolved row exists)
- Env fields: `TARGET_ADDRESS`, `SOLUTION_HASH` (commitment only, not win gate), `PUZZLE_WORDS` (12 comma-separated words)
- Normalizes mnemonics (`trim`, lowercase, collapse spaces)
- Evaluates: constraints pass/fail, BIP39 checksum validity, derived address match (`mnemonicToAddressCached`) to target

### Solana helpers
- `backend/solana.js`: mnemonic → Solana pubkey derivation (`m/44'/501'/0'/0'`) with LRU cache
- `backend/verify.js`: Ed25519 signature verification (unit tests; not used on the main win path)

### Store layer (`backend/store.js`)
- Redis + in-memory implementations behind one API
- Tracks global stats, winner state, leaderboard ZSET, optional payout job queue
- Publishes/subscribes realtime events on Redis channel `arena:events` when Redis is enabled

### Frontend (`frontend/`)
- **`index.html` + `main.js` + `style.css`**: arena UI (puzzle words, commitments, prize / REWARD display, **Recent puzzles** panel from `GET /puzzle/recent`, stats, leaderboard, operator **Visitor log** button → **`/visitors`** (same file as **`visitors.html`**), **New Puzzle** dialog with draft + **Copy all fields**, collapsible SSE log)
- **Visitor tracking:** selected `GET` page views log IP (from `X-Forwarded-For` when `trust proxy` is set) + **geoip-lite** city/region/country into Redis (or in-memory); **`GET /public/admin/visitor-log`** (`x-admin-key`) powers **`/visitors`**
- **`developers.html`**: agent documentation (same-origin `curl` examples; reads `GET /public/developer-info`)
- **`puzzle-wizard.html`**: operator tool for deriving `.env` fields, bundle copy, and clearing solved state (`wizard-derive`, `wizard-clear-solved` with admin key)
- Uses SSE (`GET /events`) for live updates; `puzzle_cleared` and `new_puzzle` refresh UI as implemented in `main.js`

## 3) Runtime Modes

### Redis mode (recommended for deploy)
Enabled when `REDIS_URL` is configured.
- Shared winner state across instances
- Shared leaderboard/stats
- Pub/sub fan-out for SSE across instances

### In-memory mode (dev only)
Used when `REDIS_URL` is missing.
- Single process only
- No persistence across restart
- Not safe for horizontal scaling

## 4) Core Game Semantics

### Puzzle metadata
`GET /puzzle` returns:
- `id`, `difficulty`
- shuffled `words`
- `solution_hash`, `target_address`, `constraints`
- winner/solved state
- `vault_empty` when sqlite has no unsolved row

### Win conditions
- `POST /submit`: win if evaluation says `matches_target=true`; winner set with `SET puzzle:winner NX` if not already solved

## 5) API Surface (Current)

- `GET /health`
  - `{ ok: true }`

- `GET /puzzle`
  - current puzzle + commitments + solved state

- `GET /puzzle/recent`
  - optional `?limit=` (default 10, max 50); `{ source: "sqlite" | "env", puzzles: [...] }` — vault row metadata for arena history panel; empty when not using SQLite vault

- `GET /stats`
  - global counters, derived rates, solved status, activity

- `POST /validate`
  - body: `{ mnemonic }`
  - returns checksum/target/constraint result JSON

- `POST /validate_batch`
  - body: `{ mnemonics: string[] }`
  - max batch size and concurrency from env (`VALIDATE_BATCH_MAX`, `VALIDATE_BATCH_CONCURRENCY`; legacy `PAID_TIER_*` fallbacks)
  - concurrent processing with capped concurrency

- `POST /submit`
  - body: `{ phrase | mnemonic, wallet }`
  - JSON `status`: `win` (with `winner`), `already_solved` (with `winner`), `invalid`, `valid_but_wrong`, `constraint_violation`; no round-based rejections

- `GET /leaderboard`
  - supports `?limit=` and `?wallet=`
  - returns top list and optional self metrics (`rank`, `gap_to_leader`)

- `GET /version`
  - `{ version }` from `backend/package.json`

- `GET /prize/balances`
  - SPL + SOL snapshot for `TARGET_ADDRESS` (RPC); SPL mint from env resolution (`PRIZE_SPL_MINT` → `QUEST_MINT` → `USDC_MINT` → default)

- `GET /payout/jobs`
  - optional `?limit=`; returns `{ jobs }` when payout pipeline is configured

- `POST /payout/jobs/:jobId/attempt` (`x-admin-key`)
  - body `{ tx_sig?, error? }`; records an audited payout attempt

- `GET /events` (SSE)
  - realtime event stream (`hello`, `attempt`, `leaderboard_update`, `submit`, `win`, `puzzle_cleared`, `payout_job`, `new_puzzle`, …)

- `GET /public/developer-info`
  - `validate_batch_max`, `rate_limit_validate_batch_per_sec`, `wizard_derive_enabled`

- `POST /public/wizard-derive` (operator; off in production unless `ALLOW_WIZARD_DERIVE`)
  - derives target, hash, word lists for `puzzle-wizard.html`

- `POST /public/wizard-clear-solved` (`x-admin-key` = `ADMIN_CONTROL_KEY`)
  - deletes `puzzle:winner` in Redis (or in-memory equivalent); emits `puzzle_cleared`

- `POST /public/admin/new-puzzle-draft` (`x-admin-key`, sqlite vault open)
  - generates a BIP39 mnemonic and derived target/hash/words/constraints (same as wizard); returns a draft for operator review (no vault write)

- `POST /public/admin/new-puzzle` (`x-admin-key`, sqlite vault open)
  - retires unsolved row(s), inserts row from JSON body, reloads arena, clears winner, optional QUEST fund

- `GET /public/admin/visitor-log` (`x-admin-key`)
  - query `limit`, `offset`; JSON `{ ok, visitors, total }` — page views with IP, geo fields, path, user-agent

## 6) Stats and Leaderboard

### Stats
Tracked metrics include:
- attempts (`validations_single`, `batch_items`, `submits`)
- `valid_checksums`
- `constraint_rejects`, `invalid_mnemonics`, `valid_target_misses`
- computed `attempts_per_sec`, `time_elapsed`, `valid_rate`

### Leaderboard
- Redis ZSET key: `leaderboard:global`
- Large score bonus on a successful win (`POST /submit` after winner set); default `LEADERBOARD_WIN_POINTS` (see `ENV_SETTINGS.md`)
- Smaller +1 increments on valid-checksum near misses (`valid_but_wrong`)
- Optional negative penalty on constraint violations (`LEADERBOARD_CONSTRAINT_PENALTY`)
- Per-wallet per-second increment cap applies to near-miss increments only (`LEADERBOARD_MAX_INCR_PER_SEC`)

## 7) Payout jobs (optional)

- When `PAYOUT_AMOUNT_USDC` > 0, a background tick creates at most one audited job per `(puzzle id, winner, amount)` while the puzzle is solved with a winner (idempotent). SSE may emit `payout_job` with `puzzle_id`.
- Operators list jobs via `GET /payout/jobs` and record chain results via `POST /payout/jobs/:jobId/attempt` (see `ENV_SETTINGS.md`).

## 8) Deployment Model (Website + API)

### Minimal production posture
- Run backend as long-lived service (systemd/PM2/container)
- Put HTTPS reverse proxy in front (e.g. Nginx)
- Set `REDIS_URL` for persistence and multi-instance safety
- Tune rate limits and batch sizes for your traffic
- Restrict CORS to your website origin(s)

### Website integration options
- Host as subdomain (recommended): `arena.example.com` -> backend
- Or reverse-proxy path under main site: `example.com/arena/*` -> backend
- Frontend is static and already served by backend; same-origin calls work by default

## 9) Repository Layout (Current)

```text
solvequest/
├── backend/
│   ├── server.js
│   ├── puzzle.js
│   ├── store.js
│   ├── solana.js
│   ├── verify.js
│   ├── .env.example
│   ├── package.json
│   └── test/
├── frontend/
│   ├── index.html
│   ├── main.js
│   ├── style.css
│   ├── developers.html
│   ├── puzzle-wizard.html
│   ├── visitors.html
│   ├── openapi.json
│   └── … (static assets)
├── sdk/
│   └── player-agent-sdk.js
├── scripts/
│   ├── deploy.sh
│   ├── launch.sh
│   └── droplet-vault-*.sh (optional server vault bootstrap helpers)
└── docs/
    ├── ARCHITECTURE_CURRENT.md
    ├── ENV_SETTINGS.md
    └── PLAYER_AGENT_SDK.md
```

## 10) Known Caveats (Current Code)

- In-memory mode is not persistence-safe and not horizontally safe.
- `POST /validate_batch` is intentionally unauthenticated; abuse is mitigated with IP rate limits and batch size caps (tune via env).

## 11) Quick Start Commands

```bash
cd backend
cp .env.example .env
npm install
npm test
node server.js
```

Open:
- `http://localhost:3001/index.html`

