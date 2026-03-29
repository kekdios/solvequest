# SolveQuest PoC

Competition backend with **Redis** (optional in-memory fallback), **atomic claims**, **Solana signatures**, **batch validation** (no API keys), and **SSE** (Redis pub/sub when Redis is enabled).

## Arena terminology

- **Player Agents**: user-run agents/bots competing to solve the same puzzle (run your own client against the HTTP API).
- **Leaderboard score**: counts valid-checksum near misses (`valid_but_wrong`).

## Quick start

```bash
cd backend
cp .env.example .env
npm install
npm test
node server.js
```

Set **`REDIS_URL`** for persistence and horizontal scaling. Without it, the process uses **in-memory** state (dev only).

**Optional SQLite puzzle vault:** set **`PUZZLE_SOURCE=sqlite`** plus vault env vars in `backend/.env.example`. Run `npm run vault-init -- migrate` then `npm run vault-init -- bootstrap-from-env` from **`backend/`** (uses the same **`TARGET_*` / `PUZZLE_WORDS`** as env mode for the first row). The server then loads the active **`unsolved`** puzzle from SQLite instead of static env fields. See **`docs/ENV_SETTINGS.md`** (Puzzle vault).

Notes:
- In `NODE_ENV=production`, backend now fails fast if `REDIS_URL` is missing.
- Set **`ADMIN_CONTROL_KEY`** for admin routes (`x-admin-key` header): **`POST /payout/jobs/:jobId/attempt`**, **`POST /public/wizard-clear-solved`** (clears Redis winner state from the puzzle wizard).

Round automation (new):

```env
ROUND_START_DELAY_SEC=0
ROUND_DURATION_SEC=86400
ROUND_SETTLE_GRACE_SEC=3
ROUND_ARCHIVE_DELAY_SEC=120
AUTO_ROTATE_ROUNDS=0
ROUND_ROTATION_JSON=[]
```

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

Use this process each time you want to launch a fresh round.

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

Your prize wallet is the wallet controlled by the canonical mnemonic.

- Send prize tokens (default **SAUSD** mint `CK9PodBifHymLBGeZujExFnpoLCsYxAw7t8c8LsDKLxG`, override with **`PRIZE_SPL_MINT`**) and SOL to `TARGET_ADDRESS`.
- Also send enough **SOL** for transaction fees/rent.

Typical operational minimum: keep at least ~`0.01` SOL available, and prefer a buffer (for example `0.02` to `0.05` SOL) to avoid payout operations failing due to fee starvation.

### 7) Update `.env` values

Edit `backend/.env` and set:

```env
TARGET_ADDRESS=<from step 2>
SOLUTION_HASH=<from step 3>
PUZZLE_WORDS=<comma-separated 12 words from step 4>
REDIS_URL=redis://127.0.0.1:6379
CLAIM_REQUIRE_MNEMONIC_BINDING=1
CLAIM_REQUIRE_ROUND_IN_MESSAGE=1
```

Optional round controls:

```env
ROUND_ID=alpha-1
ROUND_DURATION_SEC=86400
ROUND_SETTLE_GRACE_SEC=3
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

### Claim lane (`POST /claim`)

1. **Signed message** (recommended): **`solve:{PUZZLE_ID}:{unix_ts}:{nonce}:{mnemonic_sha256_hex}`** (or **`solve:{ROUND_ID}:{PUZZLE_ID}:{unix_ts}:{nonce}:{mnemonic_sha256_hex}`** to bind a round). The hash is **`SHA-256(normalized mnemonic)`** (hex). **Order:** parse message → time window → **verify Ed25519 signature** → compare hash to body mnemonic → idempotency / round checks → lock → eval.  
   Set **`CLAIM_REQUIRE_MNEMONIC_BINDING=1`** to **only** accept binding formats. **`CLAIM_REQUIRE_ROUND_IN_MESSAGE=1`** requires the **6-part** message with **`ROUND_ID`** (see **`GET /puzzle`** → **`round_id`**).  
   **`CLAIM_SIGNATURE_WINDOW_SEC`** (default **30**) limits stale timestamps.

2. **Idempotency** — **`claim:result:{pubkey}:{mnemonic_hash}`** (short TTL) so retries return stable JSON without double work.

3. **Global claim lock** — **`SET puzzle:claim_lock NX EX`** (`CLAIM_LOCK_TTL_SEC`, default **5**). If acquisition fails → **`{ "status": "lost_race" }`** so only one request at a time runs the expensive path.

4. **Derivation cache** — SHA-256 of normalized mnemonic → address LRU (**`DERIVATION_CACHE_MAX`**, default **5000**).

### Timed rounds

- **`ROUND_DURATION_SEC`** — on first Redis boot, sets **`puzzle:round_end_ms`** (NX) to `now + duration`. Omit to leave the round open-ended (in-memory dev: set on process start).
- **`ROUND_ID`** — stored as **`puzzle:round_id`** (NX); echoed on **`GET /puzzle`**.
- **`ROUND_SETTLE_GRACE_SEC`** (default **3**) — after **`round_end_ms`**, a short grace, then **`puzzle:round_settled`** is set and **`puzzle:round_leaderboard_winner`** = top of **`leaderboard:global`**. SSE: **`round_end`**, **`round_settled`**.
- After **`round_end`**: **`POST /claim`** and **`POST /submit`** return **`{ "status": "round_ended" }`** (cached claim results from idempotency still succeed). Leaderboard **ZSET** stops accepting new increments.
- **`GET /puzzle`** includes **`round_phase`** (`active` \| `grace` \| `settled`), **`round_settle_at_ms`**, **`round_settled`**, **`round_leaderboard_winner`**.

### Leaderboard (game score)

- Redis **`leaderboard:global`** sorted set: score = **valid checksum + wrong target** attempts (not raw spam).
- **Rate limit:** at most **`LEADERBOARD_MAX_INCR_PER_SEC`** (default **20**) score changes per wallet per second (incl. constraint penalty).
- **`GET /leaderboard?limit=20`** — **`{ "top": [ { "pubkey", "score" } ] }`**. With **`&wallet=<pubkey>`**, adds **`self`**: **`score`**, **`rank`**, **`leader_score`**, **`gap_to_leader`**.
- Optional **`LEADERBOARD_CONSTRAINT_PENALTY`** (e.g. **`-0.5`**) applied on constraint rejects (submit + claim).

### Stats (extended)

`GET /stats` includes **`attempts_per_sec`**, **`time_elapsed`**, **`valid_rate`** (`valid_checksums / attempts_total`), plus:

- `constraint_rejects`
- `invalid_mnemonics`
- `valid_target_misses`
- `address_mismatches` (claim: mnemonic valid but `pubkey` ≠ derived address)

### Batch validation (`POST /validate_batch`)

- **No API keys or credits.** Max mnemonics per request: **`VALIDATE_BATCH_MAX`** (default **1000**, cap **2000**), or legacy **`PAID_TIER_BATCH_MAX`** if **`VALIDATE_BATCH_MAX`** is unset.
- Internal concurrency: **`VALIDATE_BATCH_CONCURRENCY`** (default **32**), or **`PAID_TIER_BATCH_CONCURRENCY`** as fallback.
- Per-IP rate limit: **`RATE_LIMIT_VALIDATE_BATCH_MAX`** (default **20** req/s).

### Puzzle metadata

- **`GET /puzzle`** includes **`difficulty`**, **`round_id`**, **`round_end_ms`**, **`round_active`**, **`round_phase`**, settlement fields (see Timed rounds).
- **Word display order is stable per backend process**: words are shuffled once at startup and reused on each `/puzzle` response.

### SSE across instances

- With **Redis**: events are **`PUBLISH arena:events`**; each instance **subscribes** and pushes to its local SSE clients (no double delivery on the publishing node).
- Without Redis: local broadcast only.
- Structured types include **`attempt`**, **`leaderboard_update`** (with **`top`** preview), **`round_end`**, **`round_settled`** ( **`leaderboard_winner`**, **`puzzle_winner`** ), **`puzzle_cleared`** (winner cleared for a new round), plus **`claim`** / **`submit`** / **`win`**.

---

## API summary

| Endpoint | Notes |
|----------|--------|
| `GET /version` | `{ version }` from `backend/package.json` (arena footer) |
| `GET /public/developer-info` | `validate_batch_max`, `rate_limit_validate_batch_per_sec`, `wizard_derive_enabled` (for `/developers` + wizard UI) |
| `POST /claim` | Body: `mnemonic`, `pubkey`, `signature` (base58), signed `message` (binding + optional round; see above) |
| `POST /validate_batch` | Body `{ mnemonics }`; no auth; size cap and concurrency from env (see Batch validation) |
| `GET /stats` | Counters + `attempts_per_sec`, `valid_rate`, arena time |
| `GET /leaderboard` | `?limit=&wallet=` → `{ top, self? }` |
| `GET /prize/balances` | Prize wallet SAUSD + SOL balances (RPC) |
| Others | `/validate`, `/submit`, `/puzzle`, `/events`, operator wizard routes under `/public/wizard-*` |

---

## Redis keys (reference)

| Key | Purpose |
|-----|---------|
| `stats:global` | Hash: counters including new outcome fields |
| `leaderboard:global` | ZSET: valid-checksum near-miss scores |
| `puzzle:round_end_ms` | Round cutoff (optional) |
| `puzzle:round_id` | Round identifier |
| `puzzle:round_settled` | Set when round is finalized after grace |
| `puzzle:round_leaderboard_winner` | Top ZSET pubkey at settlement |
| `arena:round_end_event:{round_id}` | NX flag for one `round_end` broadcast |
| `puzzle:winner` | Winner id (`SET NX`) |
| `puzzle:claim_lock` | Short TTL global lock for claim evaluation |
| `claim:result:{pubkey}:{mnemonic_hash}` | Idempotency cache |
| `arena:events` | Pub/sub channel for SSE fan-out |

---

## Operational notes

- **Horizontal scaling**: require **Redis**; point all instances at the same **`REDIS_URL`**.
