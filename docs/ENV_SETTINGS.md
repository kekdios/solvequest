# SolveQuest Environment Settings Reference

This file explains all environment variables currently used by the backend code.

Use it alongside:
- `backend/.env.example` (starter template)
- `README.md` (operational overview)

---

## Quick baseline (recommended)

At minimum for a real deployment, set these in `backend/.env`:

```env
TARGET_ADDRESS=...
SOLUTION_HASH=...
PUZZLE_WORDS=word1,word2,word3,word4,word5,word6,word7,word8,word9,word10,word11,word12
REDIS_URL=redis://127.0.0.1:6379
CLAIM_REQUIRE_MNEMONIC_BINDING=1
CLAIM_REQUIRE_ROUND_IN_MESSAGE=1
```

---

## Core puzzle settings

### `TARGET_ADDRESS` (required)
- **Purpose:** Solana address that a mnemonic must derive to in order to win.
- **Used by:** `backend/puzzle.js`.
- **Notes:** Required at startup.

### `SOLUTION_HASH` (required)
- **Purpose:** Public commitment hash (`SHA-256` of normalized mnemonic).
- **Used by:** `backend/puzzle.js`, exposed in `/puzzle`.
- **Notes:** Commitment only; not the actual win check.

### `PUZZLE_WORDS` (required)
- **Purpose:** Comma-separated 12-word pool shown to clients.
- **Used by:** `backend/puzzle.js`.
- **Notes:** Must contain exactly 12 words.

### `PUZZLE_ID` (optional, default `001`)
- **Purpose:** Logical puzzle identifier for claim message binding.
- **Used by:** `backend/puzzle.js`.

### `PUZZLE_DIFFICULTY` (optional)
- **Purpose:** Override difficulty label (`easy`, `medium`, `hard`).
- **Used by:** `backend/puzzle.js`.
- **Default behavior:** computed from constraints.

### `PUZZLE_CONSTRAINTS_JSON` (optional)
- **Purpose:** Constraint object (currently `fixed_positions`).
- **Used by:** `backend/puzzle.js`.
- **Format example:**
  ```json
  {"fixed_positions":{"0":"estate","11":"wisdom"}}
  ```

---

## Runtime / server settings

### `PORT` (optional, default `3001`)
- **Purpose:** Backend listen port.
- **Used by:** `backend/server.js`.

### `REDIS_URL` (strongly recommended for deploy)
- **Purpose:** Enable Redis-backed persistence and multi-instance safety.
- **Used by:** `backend/store.js`.
- **If missing:** falls back to in-memory mode (dev only).
- **Production rule:** with `NODE_ENV=production`, backend now fails to start if `REDIS_URL` is missing.

### `SOLANA_RPC_URL` (optional, default `https://api.mainnet-beta.solana.com`)
- **Purpose:** RPC endpoint for prize wallet balance reads (`/prize/balances`).
- **Used by:** `backend/server.js`.

### `USDC_MINT` (optional, default mainnet USDC mint)
- **Purpose:** Token mint used for prize USDC balance lookup.
- **Used by:** `backend/server.js`.
- **Default:** `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.

### `PRIZE_BALANCE_TTL_MS` (optional, default `10000`)
- **Purpose:** Cache TTL for RPC prize balance reads.
- **Used by:** `backend/server.js`.

### `ADMIN_CONTROL_KEY` (recommended in all non-local environments)
- **Purpose:** Protect admin-only HTTP endpoints.
- **Used by:** `backend/server.js`.
- **How:** client must send `x-admin-key: <ADMIN_CONTROL_KEY>` for:
  - `POST /payout/jobs/:jobId/attempt`

### `API_KEY_REQUEST_URL` (optional)
- **Purpose:** URL for “Request API key” on `/developers` (e.g. Google Form).
- **Used by:** `backend/server.js` (`GET /public/developer-info`).

### `API_KEY_REQUEST_EMAIL` (optional)
- **Purpose:** Shown as mailto on `/developers` when operators prefer email over a form.
- **Used by:** `backend/server.js` (`GET /public/developer-info`).

### `ALLOW_WIZARD_DERIVE` (optional)
- **Purpose:** In **`NODE_ENV=production`**, enables **`POST /public/wizard-derive`** used by **`puzzle-wizard.html`** (mnemonic in JSON body). In non-production, the endpoint is on by default unless set to a falsy value (`0`, `false`, `no`, `off`).
- **Truthy values:** `1`, `true`, `yes`, `on` (case-insensitive). **Falsy:** `0`, `false`, `no`, `off`.
- **Used by:** `backend/server.js`.
- **Recommendation:** use only with **HTTPS**; treat as operator-only. After changing `.env`, **restart** the backend so `GET /public/developer-info` returns `wizard_derive_enabled: true`.

### `WIZARD_DERIVE_MAX_PER_MIN` (optional, default `40`)
- **Purpose:** Rate limit for **`/public/wizard-derive`** per IP per minute (clamped 5–200).
- **Used by:** `backend/server.js`.

### `PAYOUT_AMOUNT_USDC` (optional, default `0`)
- **Purpose:** If >0, create audited payout job on round settlement when a winner exists.
- **Used by:** `backend/server.js` + `backend/store.js`.

### `PAYOUT_MAX_RETRIES` (optional, default `5`)
- **Purpose:** Max retries for payout attempt tracking.
- **Used by:** `backend/store.js`.

---

## Round lifecycle settings

### `ROUND_ID` (optional, default `default`)
- **Purpose:** Round identifier.
- **Used by:** `backend/puzzle.js`, `backend/store.js`.

### `ROUND_DURATION_SEC` (optional)
- **Purpose:** Set round end timestamp on init.
- **Used by:** `backend/store.js`.

### `ROUND_START_DELAY_SEC` (optional, default `0`)
- **Purpose:** Delay round activation after boot/rotation.
- **Used by:** `backend/store.js`.

### `ROUND_SETTLE_GRACE_SEC` (optional, default `3`)
- **Purpose:** Grace window after round end before settlement.
- **Used by:** `backend/store.js`.

### `ROUND_ARCHIVE_DELAY_SEC` (optional, default `120`)
- **Purpose:** Delay from settled -> archived phase.
- **Used by:** `backend/store.js`.

### `AUTO_ROTATE_ROUNDS` (optional, default off)
- **Purpose:** Enable automatic metadata rotation after round archive.
- **Used by:** `backend/server.js`.

### `ROUND_ROTATION_JSON` (optional, default empty)
- **Purpose:** Array of next-round metadata objects for auto-rotation.
- **Used by:** `backend/server.js`.
- **Supported fields per item:** `id`, `round_id`, `target_address`, `solution_hash`, `words` (12), `constraints`, `difficulty`, `round_duration_sec`, `round_start_delay_sec`.

---

## Claim security settings

### `CLAIM_REQUIRE_MNEMONIC_BINDING` (optional, recommended `1` in prod)
- **Purpose:** Require claim messages to include mnemonic hash binding.
- **Used by:** `backend/server.js`.

### `CLAIM_REQUIRE_ROUND_IN_MESSAGE` (optional, recommended `1` when rounds enabled)
- **Purpose:** Require round-bound claim message format.
- **Used by:** `backend/server.js`, `backend/puzzle.js` parser.

### `CLAIM_REQUIRE_NONCE` (optional)
- **Purpose:** Require nonce in non-round message formats.
- **Used by:** `backend/server.js`.

### `ALLOW_LEGACY_SOLVE_MESSAGE` (optional, default off)
- **Purpose:** Allow old weak claim message format.
- **Used by:** `backend/server.js`.
- **Recommendation:** leave disabled in production.

### `CLAIM_SIGNATURE_WINDOW_SEC` (optional, default `30`, clamped `5..300`)
- **Purpose:** Max timestamp skew for signed claim messages.
- **Used by:** `backend/server.js`.

### `CLAIM_LOCK_TTL_SEC` (optional, default `5`, clamped `1..30`)
- **Purpose:** Claim lock TTL to reduce race conditions.
- **Used by:** `backend/store.js`.

### `SIGNED_MESSAGE_DEDUP_TTL_SEC` (optional, default `60`, clamped `10..600`)
- **Purpose:** Replay dedup window for exact signed message.
- **Used by:** `backend/store.js`.

---

## Rate limits (HTTP)

### `RATE_LIMIT_VALIDATE_MAX` (optional, default `120` req/s per IP)
- **Route:** `POST /validate`
- **Used by:** `backend/server.js`.

### `RATE_LIMIT_VALIDATE_BATCH_MAX` (optional, default `20` req/s per IP)
- **Route:** `POST /validate_batch`
- **Used by:** `backend/server.js`.

### `RATE_LIMIT_SUBMIT_MAX` (optional, default `5` req/s per IP)
- **Route:** `POST /submit`
- **Used by:** `backend/server.js`.

### `RATE_LIMIT_CLAIM_MAX` (optional, default `60` req/s per IP)
- **Route:** `POST /claim`
- **Used by:** `backend/server.js`.

---

## Batch validation / credits settings

### `FREE_TIER_BATCH_MAX` (optional, default `50`, max `500`)
- **Purpose:** Max batch size without API key.
- **Used by:** `backend/server.js`.

### `PAID_TIER_BATCH_MAX` (optional, default `1000`, max `2000`)
- **Purpose:** Max batch size with paid key.
- **Used by:** `backend/server.js`.

### `VALIDATE_BATCH_MAX` (optional)
- **Purpose:** Hard cap safety on batch size inside handler.
- **Used by:** `backend/server.js`.

### `FREE_TIER_BATCH_CONCURRENCY` (optional, default `8`, max `128`)
- **Purpose:** Internal processing concurrency for free tier.
- **Used by:** `backend/server.js`.

### `PAID_TIER_BATCH_CONCURRENCY` (optional, default `32`, max `128`)
- **Purpose:** Internal processing concurrency for paid tier.
- **Used by:** `backend/server.js`.

### `BATCH_CREDIT_BASE` (optional, default `0`)
- **Purpose:** Fixed base credit charge per batch request.
- **Used by:** `backend/server.js`.

### `BATCH_CREDIT_UNIT` (optional, default `1`)
- **Purpose:** Per-item credit charge in batch.
- **Used by:** `backend/server.js`.

### `CREDITS_SCALE_UNITS` (optional, default `1000`)
- **Purpose:** Integer micro-unit scale for credits.
- **Used by:** `backend/store.js`.
- **Recommendation:** `1000000` for USDC-aligned accounting.

### `API_KEYS_JSON` (optional, dev/in-memory mode)
- **Purpose:** Seed API keys when Redis is not used.
- **Used by:** `backend/store.js`.
- **Format example:**
  ```json
  {
    "sk_test_abc": { "credits_micro": 1000000, "tier": "paid" }
  }
  ```

---

## Leaderboard settings

### `LEADERBOARD_MAX_INCR_PER_SEC` (optional, default `20`, max `500`)
- **Purpose:** Per-wallet score increment cap per second.
- **Used by:** `backend/store.js`.

### `LEADERBOARD_CONSTRAINT_PENALTY` (optional)
- **Purpose:** Optional negative score delta on constraint violations.
- **Used by:** `backend/store.js`.
- **Example:** `-0.5`.

### `LEADERBOARD_WIN_POINTS` (optional, default `100000`)
- **Purpose:** Score added to `GET /leaderboard` when a wallet wins via `POST /submit` or `POST /claim` (same sorted set as near-miss +1s, but much larger so winners appear at the top).
- **Used by:** `backend/store.js` (`recordLeaderboardWin`).
- **Note:** Not subject to `LEADERBOARD_MAX_INCR_PER_SEC` (wins are once per puzzle).

---

## Performance/cache settings

### `EVAL_LRU_MAX` (optional, default `5000`, min `100`, max `100000`)
- **Purpose:** Size of mnemonic evaluation LRU cache.
- **Used by:** `backend/puzzle.js`.

### `DERIVATION_CACHE_MAX` (optional, default `5000`, min `100`, max `100000`)
- **Purpose:** Size of mnemonic->address derivation LRU cache.
- **Used by:** `backend/solana.js`.

---

## Notes on commented settings in `.env`

It is normal for most settings to remain commented out.

Only enable values you intentionally want to control. The app has built-in defaults for most tuning knobs.

For production, the key priorities are:
1. set required puzzle values
2. enable Redis
3. enforce strong claim flags
4. tune limits/pricing only as needed

