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
- signed-claim lane for stronger trust (`/claim`)
- batch validation API with no API keys (`/validate_batch`; limits from env)
- realtime feed and leaderboard

## 2) System Components

## Backend (`backend/server.js`)
- Express API server (default `PORT=3001`)
- Serves static frontend from `frontend/`
- Handles validation, claims, leaderboard, stats, rounds, and SSE
- Uses Redis when `REDIS_URL` is set; otherwise falls back to in-memory store

## Puzzle/Evaluation (`backend/puzzle.js`)
- Loads puzzle config from env:
  - `TARGET_ADDRESS`
  - `SOLUTION_HASH` (commitment only, not win gate)
  - `PUZZLE_WORDS` (12 comma-separated words)
- Normalizes mnemonics (`trim`, lowercase, collapse spaces)
- Evaluates:
  - constraints pass/fail
  - BIP39 checksum validity
  - derived address match (`mnemonicToAddressCached`) to target
- Provides solve-message parser for signed claims

## Solana Helpers
- `backend/solana.js`: mnemonic -> Solana pubkey derivation (`m/44'/501'/0'/0'`) with LRU cache
- `backend/verify.js`: Ed25519 signature verification for base58 pubkey/signature

## Store Layer (`backend/store.js`)
- Redis + in-memory implementations behind one API
- Tracks global stats, winner state, leaderboard ZSET, rounds, claim lock/idempotency
- Publishes/subscribes realtime events on Redis channel `arena:events` when Redis is enabled

## Frontend (`frontend/`)
- **`index.html` + `main.js` + `style.css`**: arena UI (puzzle words, commitments, SAUSD display, countdown, stats, leaderboard, collapsible SSE log)
- **`developers.html`**: agent documentation (same-origin `curl` examples; reads `GET /public/developer-info`)
- **`puzzle-wizard.html`**: operator tool for deriving `.env` fields and clearing solved state (`wizard-derive`, `wizard-clear-solved` with admin key)
- Uses SSE (`GET /events`) for live updates; `puzzle_cleared` events refresh solved UI
- Submits via `POST /submit`

## 3) Runtime Modes

## Redis mode (recommended for deploy)
Enabled when `REDIS_URL` is configured.
- Shared winner state across instances
- Shared leaderboard/stats
- Redis-backed claim lock and idempotency
- Pub/sub fan-out for SSE across instances

## In-memory mode (dev only)
Used when `REDIS_URL` is missing.
- Single process only
- No persistence across restart
- Not safe for horizontal scaling

## 4) Core Game and Claim Semantics

## Puzzle Metadata
`GET /puzzle` returns:
- `id`, `round_id`, `difficulty`
- shuffled `words`
- `solution_hash`, `target_address`, `constraints`
- winner/solved state
- round timing/phase fields

## Win Conditions
- `POST /submit`: win if evaluation says `matches_target=true`; winner set if not already solved
- `POST /claim`: requires signature verification and claim checks, then win if:
  - mnemonic is valid + passes constraints
  - derived address equals provided `pubkey`
  - derived address matches configured target
  - winner is atomically set

## Solve Message Formats (`/claim`)
Supported by parser (gated by env flags):
- strong round-bound: `solve:{round_id}:{puzzle_id}:{ts}:{nonce}:{mnemonic_sha256_hex}`
- strong puzzle-bound: `solve:{puzzle_id}:{ts}:{nonce}:{mnemonic_sha256_hex}`
- weaker legacy forms may be allowed by env

Recommended production flags:
- `CLAIM_REQUIRE_MNEMONIC_BINDING=1`
- `CLAIM_REQUIRE_ROUND_IN_MESSAGE=1` (when rounds are used)

## Replay/Race Protections
- Signature time window (`CLAIM_SIGNATURE_WINDOW_SEC`)
- Signed-message one-time consume (`consumeSignedMessageOnce`)
- Claim idempotency cache keyed by `pubkey + mnemonic_hash`
- Claim lock (`puzzle:claim_lock`)
- Atomic winner set + lock release in Redis script (`trySetWinnerAtomic`)

## 5) API Surface (Current)

- `GET /health`
  - `{ ok: true }`

- `GET /puzzle`
  - current puzzle + commitment + round metadata

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
  - browser-friendly submit lane

- `POST /claim`
  - body: `{ mnemonic, pubkey, signature, message }`
  - signed, trust-hardened claim lane

- `GET /leaderboard`
  - supports `?limit=` and `?wallet=`
  - returns top list and optional self metrics (`rank`, `gap_to_leader`)

- `GET /events` (SSE)
  - realtime event stream (`hello`, `attempt`, `leaderboard_update`, `submit`, `claim`, `win`, `puzzle_cleared`, `round_end`, `round_settled`, …)

- `GET /public/developer-info`
  - `validate_batch_max`, `rate_limit_validate_batch_per_sec`, `wizard_derive_enabled`

- `POST /public/wizard-derive` (operator; off in production unless `ALLOW_WIZARD_DERIVE`)
  - derives target, hash, word lists for `puzzle-wizard.html`

- `POST /public/wizard-clear-solved` (`x-admin-key` = `ADMIN_CONTROL_KEY`)
  - deletes `puzzle:winner` and `puzzle:claim_lock` in Redis (or in-memory equivalents); emits `puzzle_cleared`

## 6) Stats and Leaderboard

## Stats
Tracked metrics include:
- attempts (`validations_single`, `batch_items`, `submits`, `claims`)
- `valid_checksums`
- `constraint_rejects`, `invalid_mnemonics`, `valid_target_misses`, `address_mismatches`
- computed `attempts_per_sec`, `time_elapsed`, `valid_rate`

## Leaderboard
- Redis ZSET key: `leaderboard:global`
- Large score bonus on a successful win (`POST /submit` or `POST /claim` after atomic winner set); default `LEADERBOARD_WIN_POINTS` (see `ENV_SETTINGS.md`)
- Smaller +1 increments on valid-checksum near misses (`valid_but_wrong`)
- Optional negative penalty on constraint violations (`LEADERBOARD_CONSTRAINT_PENALTY`)
- Per-wallet per-second increment cap applies to near-miss increments only (`LEADERBOARD_MAX_INCR_PER_SEC`)

## 7) Round Lifecycle

- `ROUND_DURATION_SEC` sets round end on first initialization (Redis NX)
- `getRoundState()` exposes phase:
  - `active`
  - `grace` (after end, before settlement)
  - `settled`
- During non-active rounds:
  - `/submit` returns `round_ended`
  - `/claim` returns cached idempotent result or `round_ended`
- Background tick:
  - emits `round_end`
  - settles round after grace (`ROUND_SETTLE_GRACE_SEC`)
  - captures `round_leaderboard_winner`

## 8) Deployment Model (Website + API)

## Minimal production posture
- Run backend as long-lived service (systemd/PM2/container)
- Put HTTPS reverse proxy in front (e.g. Nginx)
- Set `REDIS_URL` for persistence and multi-instance safety
- Configure strict env flags for claim security
- Restrict CORS to your website origin(s)

## Website integration options
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
│   ├── openapi.json
│   └── … (static assets)
├── sdk/
│   └── player-agent-sdk.js
├── scripts/
│   ├── deploy.sh
│   └── launch.sh
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

