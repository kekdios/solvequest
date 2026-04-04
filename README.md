# SolveQuest PoC

Competition backend with **Redis** (optional in-memory fallback), **batch validation** (no API keys), and **SSE** (Redis pub/sub when Redis is enabled).

## Arena terminology

- **Player Agents**: user-run agents/bots competing to solve the same puzzle (run your own client against the HTTP API).

## Quick start

```bash
cd backend
cp .env.example .env
npm install
npm test
node server.js
```

Set **`REDIS_URL`** for persistence and horizontal scaling. Without it, the process uses **in-memory** state (dev only).

**Optional SQLite puzzle vault:** set **`PUZZLE_SOURCE=sqlite`** plus **`SQLITE_PATH`** (see `backend/.env.example`). Run `npm run vault-init -- migrate` then `npm run vault-init -- bootstrap-from-env` from **`backend/`** (uses the same **`TARGET_*` / `PUZZLE_WORDS`** as env mode for the first row). The server loads the active **`unsolved`** puzzle from SQLite; the arena can show **Recent puzzles** (`GET /puzzle/recent`) and operators can use **New Puzzle** in the UI (admin key + vault). Full env contract: **`docs/ENV_SETTINGS.md`** (Puzzle vault).

Notes:
- In `NODE_ENV=production`, backend now fails fast if `REDIS_URL` is missing.
- Set **`ADMIN_CONTROL_KEY`** for admin routes (`x-admin-key` header): **`POST /public/admin/new-puzzle-draft`** and **`POST /public/admin/new-puzzle`** (SQLite vault only), **`POST /payout/jobs/:jobId/attempt`**, **`POST /public/wizard-clear-solved`** (clears Redis/in-memory winner).

Payout pipeline (audited jobs):

```env
PAYOUT_AMOUNT_USDC=0
PAYOUT_MAX_RETRIES=5
```

API:
- `GET /openapi.json` — machine-readable route outline (same origin as the arena)
- `GET /payout/jobs`
- `POST /payout/jobs/:jobId/attempt` (admin key required)

## Create a new puzzle (step-by-step)

Use this process each time you want to launch a fresh puzzle.

**Local wizard (derived values + copy buttons):** with the backend running, open **`http://127.0.0.1:<port>/puzzle-wizard.html`**. Derivation uses **`POST /public/wizard-derive`** on the same server (no browser CDN). On production set **`ALLOW_WIZARD_DERIVE=1`** if you want the wizard enabled.

### 0) Safety first (important)

- Generate and store the canonical 12-word phrase in a secure/offline workflow.
- Do not commit secrets to git.
- `SOLUTION_HASH` is safe to publish; the canonical phrase is not.

### 1) Generate a valid 12-word mnemonic

From repo root:

```bash
cd backend
node --input-type=module -e "import bip39 from 'bip39'; console.log(bip39.generateMnemonic(128));"
```

Save this output as your **canonical solution phrase** (private).

### 2) Derive target Solana address from that phrase

Run this command, replacing `MNEMONIC_HERE`:

```bash
cd backend
MNEMONIC="MNEMONIC_HERE" node --input-type=module -e "import { mnemonicToAddress } from './solana.js'; console.log(mnemonicToAddress(process.env.MNEMONIC));"
```

Output is your `TARGET_ADDRESS`.

### 3) Generate `SOLUTION_HASH` (what it is)

`SOLUTION_HASH` is `SHA-256` of the **normalized mnemonic** (trim + lowercase + single spaces).

```bash
cd backend
MNEMONIC="MNEMONIC_HERE" node --input-type=module -e "import { hashMnemonic } from './puzzle.js'; console.log(hashMnemonic(process.env.MNEMONIC));"
```

Output is your `SOLUTION_HASH`.

### 4) Build `PUZZLE_WORDS` and randomize display order

Create a comma-separated 12-word pool from the canonical phrase:

```bash
MNEMONIC="MNEMONIC_HERE" node -e "console.log(process.env.MNEMONIC.trim().toLowerCase().split(/\s+/).join(','))"
```

Put that into `PUZZLE_WORDS` in `.env`.

Notes:
- The backend now shuffles this pool once at startup for display.
- Display order is stable until service restart/deploy.

### 5) Test the phrase before launch

Start backend:

```bash
cd backend
node server.js
```

From another terminal, test canonical phrase:

```bash
curl -sS -X POST http://127.0.0.1:3001/validate \
  -H "Content-Type: application/json" \
  -d '{"mnemonic":"MNEMONIC_HERE"}'
```

Expected:
- `valid_checksum: true`
- `matches_target: true`

Also test a wrong permutation (same words, different order) and verify it does not match target.

### 6) Fund the prize wallet and add SOL for transaction fees

Your prize wallet is the on-chain address **`TARGET_ADDRESS`** (derived from the canonical mnemonic).

- Send the **prize SPL** you want the arena to display (balance read via **`GET /prize/balances`**) to `TARGET_ADDRESS`. The server chooses the mint in this order: **`PRIZE_SPL_MINT`** → **`QUEST_MINT`** → legacy **`USDC_MINT`** → default **SAUSD** mint `CK9PodBifHymLBGeZujExFnpoLCsYxAw7t8c8LsDKLxG`. Amounts are on-chain **ui** balances, not a market USD price.
- Also send enough **SOL** for transaction fees/rent.

Typical operational minimum: keep at least ~`0.01` SOL available, and prefer a buffer (for example `0.02` to `0.05` SOL) to avoid payout operations failing due to fee starvation.

### 7) Update `.env` values

Edit `backend/.env` and set:

```env
TARGET_ADDRESS=<from step 2>
SOLUTION_HASH=<from step 3>
PUZZLE_WORDS=<comma-separated 12 words from step 4>
REDIS_URL=redis://127.0.0.1:6379
```

Then restart:

```bash
systemctl restart solvequest
```

### 8) Post-launch sanity checks

```bash
curl -sS https://your-domain/health
curl -sS https://your-domain/puzzle
```

You should see healthy API and expected puzzle metadata.

## Deploy from local machine

Use the included deploy helper from your local terminal:

```bash
./scripts/deploy.sh
```

Default behavior:
- SSH target: `root@152.42.168.173`
- Branch: `main`
- App path on server: `/opt/solvequest`
- Service restart: `solvequest`
- SSH mode: key-only (`BatchMode=yes`)
- Health checks: local (`127.0.0.1:3001/health`) and public (`https://solvequest.io/health`)

Optional overrides:

```bash
DEPLOY_TARGET=root@your-server-ip BRANCH=main APP_DIR=/opt/solvequest SERVICE_NAME=solvequest PUBLIC_HEALTH_URL=https://your-domain/health ./scripts/deploy.sh
```

## Player agent SDK

- **Live docs (same origin as the arena):** `/developers` — hello-world loop, limits from `GET /public/developer-info`
- **OpenAPI:** `/openapi.json` (batch limits, developer-info shape, wizard routes)
- SDK file: `sdk/player-agent-sdk.js`
- Guide: `docs/PLAYER_AGENT_SDK.md`

---

## Phase 5: abuse resistance + performance

### Win path (`POST /submit`)

Wins are registered when evaluation finds a valid mnemonic that matches **`TARGET_ADDRESS`**. **`SET puzzle:winner NX`** ensures only one winner per puzzle in Redis (or equivalent in-memory flag).

**Derivation cache:** normalized mnemonic → address LRU (**`DERIVATION_CACHE_MAX`**, default **5000**).

### Stats (extended)

`GET /stats` includes **`attempts_per_sec`**, **`time_elapsed`**, **`valid_rate`** (`valid_checksums / attempts_total`), plus:

- `constraint_rejects`
- `invalid_mnemonics`
- `valid_target_misses`

### Batch validation (`POST /validate_batch`)

- **No API keys or credits.** Max mnemonics per request: **`VALIDATE_BATCH_MAX`** (default **1000**, cap **2000**), or legacy **`PAID_TIER_BATCH_MAX`** if **`VALIDATE_BATCH_MAX`** is unset.
- Internal concurrency: **`VALIDATE_BATCH_CONCURRENCY`** (default **32**), or **`PAID_TIER_BATCH_CONCURRENCY`** as fallback.
- Per-IP rate limit: **`RATE_LIMIT_VALIDATE_BATCH_MAX`** (default **20** req/s).

### Puzzle metadata

- **`GET /puzzle`** includes **`id`**, **`difficulty`**, **`vault_empty`** (sqlite fallback), commitments, and solved state.
- **Word display order is stable per backend process**: words are shuffled once at startup and reused on each `/puzzle` response.

### SSE across instances

- With **Redis**: events are **`PUBLISH arena:events`**; each instance **subscribes** and pushes to its local SSE clients (no double delivery on the publishing node).
- Without Redis: local broadcast only.
- Structured types include **`puzzle_cleared`**, **`new_puzzle`**, **`payout_job`**, plus **`submit`** / **`win`**.

---

## API summary

| Endpoint | Notes |
|----------|--------|
| `GET /version` | `{ version }` from `backend/package.json` (arena footer) |
| `GET /public/developer-info` | `validate_batch_max`, `rate_limit_validate_batch_per_sec`, `wizard_derive_enabled` (for `/developers` + wizard UI) |
| `POST /validate_batch` | Body `{ mnemonics }`; no auth; size cap and concurrency from env (see Batch validation) |
| `GET /stats` | Counters + `attempts_per_sec`, `valid_rate`, arena time |
| `GET /prize/balances` | SPL balance on `TARGET_ADDRESS` for resolved prize mint + SOL (RPC); mint = `PRIZE_SPL_MINT` → `QUEST_MINT` → `USDC_MINT` → SAUSD default |
| `GET /puzzle/recent` | Recent vault rows (SQLite); `{ source, puzzles }` — empty when `PUZZLE_SOURCE=env` |
| Others | `/validate`, `/submit`, `/puzzle`, `/events`, `/public/wizard-derive`, `/public/wizard-clear-solved`, `/public/admin/new-puzzle-draft`, `/public/admin/new-puzzle` |

---

## Redis keys (reference)

| Key | Purpose |
|-----|---------|
| `stats:global` | Hash: counters including new outcome fields |
| `puzzle:winner` | Winner id (`SET NX`) |
| `arena:events` | Pub/sub channel for SSE fan-out |

---

## Operational notes

- **Horizontal scaling**: require **Redis**; point all instances at the same **`REDIS_URL`**.
- **Visitor log** (optional operator feature): page views on `/`, `/developers`, `/puzzle-wizard.html`, etc. record client IP + approximate location via **geoip-lite**; data lives in Redis (or in-memory without `REDIS_URL`). Open **`/visitors`** (or **`/visitors.html`**), enter **`ADMIN_CONTROL_KEY`**, then **Load**. Set **`TRUST_PROXY`** when behind a reverse proxy so IPs are correct. Treat logs as **personal data** under your privacy policy.
