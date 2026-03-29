# SolveQuest Environment Settings Reference

This file explains environment variables used by the backend code (including optional future-facing vault vars parsed in `puzzle-vault-env.js`).

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

### `PRIZE_SPL_MINT` (optional, default SAUSD)
- **Purpose:** SPL token mint used for prize balance on `TARGET_ADDRESS` (`GET /prize/balances`).
- **Used by:** `backend/server.js`.
- **Default:** `CK9PodBifHymLBGeZujExFnpoLCsYxAw7t8c8LsDKLxG` (SAUSD).
- **Legacy:** `USDC_MINT` is still read if `PRIZE_SPL_MINT` is unset (older `.env` files).

### `PRIZE_BALANCE_TTL_MS` (optional, default `10000`)
- **Purpose:** Cache TTL for RPC prize balance reads.
- **Used by:** `backend/server.js`.

### `ADMIN_CONTROL_KEY` (recommended in all non-local environments)
- **Purpose:** Protect admin-only HTTP endpoints.
- **Used by:** `backend/server.js`.
- **How:** client must send `x-admin-key: <ADMIN_CONTROL_KEY>` for:
  - `POST /payout/jobs/:jobId/attempt`
  - `POST /public/wizard-clear-solved` (clear `puzzle:winner` + claim lock; used by `puzzle-wizard.html`)

### `ALLOW_WIZARD_DERIVE` (optional)
- **Purpose:** In **`NODE_ENV=production`**, enables **`POST /public/wizard-derive`** used by **`puzzle-wizard.html`** (mnemonic in JSON body). In non-production, the endpoint is on by default unless set to a falsy value (`0`, `false`, `no`, `off`).
- **Truthy values:** `1`, `true`, `yes`, `on` (case-insensitive). **Falsy:** `0`, `false`, `no`, `off`.
- **Used by:** `backend/server.js`.
- **Recommendation:** use only with **HTTPS**; treat as operator-only. After changing `.env`, **restart** the backend so `GET /public/developer-info` returns `wizard_derive_enabled: true`.

### `WIZARD_DERIVE_MAX_PER_MIN` (optional, default `40`)
- **Purpose:** Rate limit for **`/public/wizard-derive`** per IP per minute (clamped 5–200).
- **Used by:** `backend/server.js`.

### `WIZARD_CLEAR_SOLVED_MAX_PER_MIN` (optional, default `20`)
- **Purpose:** Rate limit for **`/public/wizard-clear-solved`** per IP per minute (clamped 3–100).
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

## Batch validation settings

### `VALIDATE_BATCH_MAX` (optional, default `1000`, max `2000`)
- **Purpose:** Max mnemonics per `POST /validate_batch` request.
- **Used by:** `backend/server.js`.
- **Note:** If unset, **`PAID_TIER_BATCH_MAX`** is still read as a fallback for existing deployments.

### `VALIDATE_BATCH_CONCURRENCY` (optional, default `32`, max `128`)
- **Purpose:** Parallel evaluation concurrency inside a batch handler.
- **Used by:** `backend/server.js`.
- **Note:** **`PAID_TIER_BATCH_CONCURRENCY`** is accepted as a fallback alias.

### `PAID_TIER_BATCH_MAX` / `PAID_TIER_BATCH_CONCURRENCY` (optional, legacy aliases)
- **Purpose:** Same as **`VALIDATE_BATCH_MAX`** / **`VALIDATE_BATCH_CONCURRENCY`** when the newer names are unset.
- **Used by:** `backend/server.js`.

---

## Public developer metadata

### `GET /public/developer-info` (no env vars — response shape)
Returned JSON (for **`/developers`** and **`puzzle-wizard.html`**):

| Field | Type | Meaning |
|-------|------|--------|
| `validate_batch_max` | number | Max mnemonics per `POST /validate_batch` |
| `rate_limit_validate_batch_per_sec` | number | Express rate-limit ceiling for that route (see **`RATE_LIMIT_VALIDATE_BATCH_MAX`**) |
| `wizard_derive_enabled` | boolean | Whether **`POST /public/wizard-derive`** is allowed (production requires **`ALLOW_WIZARD_DERIVE`**) |

There are **no** API keys, credits, or “request key” URLs in this response.

---

## Puzzle vault (SQLite automation)

These variables configure **optional** automated puzzle rotation with **encrypted** solutions in **SQLite** and **QUEST** SPL funding.

**Modules (backend):**
- `puzzle-vault-env.js` — `requireSqliteStorageEnv()` (path + backups) for opening the DB; `requireSqliteVaultEnv()` adds **`QUEST_*`** for funding/signing paths.
- `puzzle-vault-backup.js` — copies the live DB before mutations; prunes to **`SQLITE_BACKUP_KEEP`** files matching `vault-*.db` in the backup dir.
- `puzzle-vault-db.js` — when **`PUZZLE_SOURCE=sqlite`**, runs backup then opens SQLite via **`better-sqlite3`** and applies **`CREATE TABLE IF NOT EXISTS`** migrations only (no `DROP`, no delete of the file).

**Droplet (SSH from your laptop, same vars as `deploy.sh`):** numbered helpers in `scripts/` — run **one at a time** and paste output if anything fails:
- `droplet-vault-step0-env-hint.sh` (local only — prints `.env` template)
- `droplet-vault-step1-deploy.sh` → `deploy.sh`
- `droplet-vault-step2-mkdir.sh` — data dirs on server
- `droplet-vault-step3-migrate.sh` — `vault-init migrate`
- `droplet-vault-step4-bootstrap.sh` — `vault-init bootstrap-from-env`
- `droplet-vault-step5-restart-check.sh` — `systemctl restart` + curl checks

Override **`DEPLOY_TARGET`**, **`APP_DIR`**, **`SERVICE_NAME`**, **`PUBLIC_HEALTH_URL`** like `deploy.sh`.

**CLI (repo root or `backend/`):** with **`PUZZLE_SOURCE=sqlite`**, **`SQLITE_PATH`**, and optional backup/HKDF vars, from **`backend/`** run:
- `npm run vault-init -- migrate` — create/migrate DB file only.
- `npm run vault-init -- status` — row counts + active unsolved row.
- `npm run vault-init -- bootstrap-from-env` — insert one **`unsolved`** row from **`TARGET_ADDRESS`**, **`SOLUTION_HASH`**, **`PUZZLE_WORDS`** (and optional **`PUZZLE_CONSTRAINTS_JSON`**, **`PUZZLE_ID`**, **`ROUND_ID`**, **`PUZZLE_DIFFICULTY`**). Fails if an unsolved row already exists unless **`--force`**.

**`puzzles.puzzle_words_csv`:** 12 comma-separated words (normalized lowercase in DB) for display/evaluation; required for server load.

**Empty vault after migrate:** If there is no unsolved row yet, the server still starts and uses **`TARGET_ADDRESS`**, **`SOLUTION_HASH`**, **`PUZZLE_WORDS`** from `.env` (same values you will insert with **`bootstrap-from-env`**). After bootstrap, **restart** so the active puzzle is read from SQLite. **`GET /puzzle`** includes **`vault_empty: true`** in that state; the arena shows a **red “Vault empty”** banner until the vault has an unsolved row and the process has been restarted.

Leaving **`PUZZLE_SOURCE` unset or `env`** keeps the classic model (puzzle from env only, no SQLite vault).

**Backup policy:**
- On **open** (`openPuzzleVaultDatabase`): if the DB file **already exists** and is **non-empty**, copy it to the backup dir (then prune) **before** attaching. First boot (no file) skips backup.
- Before **mutating** puzzle data (future rotation/insert/update), call **`backupPuzzleVaultBeforeWrite(vault)`** so each logical change is preceded by a file copy.
- Schema uses **`IF NOT EXISTS`** only so migrations do not wipe existing tables.

### `PUZZLE_SOURCE` (optional, default `env`)
- **`env`** — Current model: puzzle from env at startup (`backend/puzzle.js`).
- **`sqlite`** — Vault mode: **`SQLITE_PATH`** (and optional backup/HKDF) are enough to **migrate**, **bootstrap**, and **run the server** with a vault-backed puzzle. **`QUEST_*`** is required only for code paths that sign or fund with QUEST (see below).

### `SQLITE_PATH` (required when `PUZZLE_SOURCE=sqlite`)
- **Purpose:** Absolute or relative path to the SQLite database file.
- **Used by:** vault module (later steps).

### `SQLITE_BACKUP_DIR` (optional)
- **Purpose:** Directory for timestamped file copies before mutations.
- **Default:** `<parent of SQLITE_PATH>/puzzle-vault-backups` (resolved absolute).
- **Used by:** backup helper (next step).

### `SQLITE_BACKUP_KEEP` (optional, default `7`, max `50`)
- **Purpose:** Retain at most this many backup files after each backup (oldest deleted first).
- **Used by:** backup helper (next step).

### `QUEST_OPERATOR_SECRET_KEY` (required for QUEST signing / funding; optional for migrate + bootstrap + HTTP serve)
- **Purpose:** Solana keypair secret (base58 or JSON byte array as elsewhere in Solana tooling). Used to **sign QUEST SPL transfers** to new puzzle addresses. The same material will feed **HKDF** for encrypting stored mnemonics (not raw key as AES key — see implementation plan).
- **Security:** Never commit; restrict file permissions on `.env` and backup directory.

### `QUEST_MINT` (required with operator key for QUEST flows; optional for migrate/bootstrap/serve)
- **Purpose:** SPL token mint address for the QUEST token.

### `QUEST_FUND_AMOUNT_RAW` (required with mint for QUEST flows; optional for migrate/bootstrap/serve)
- **Purpose:** Positive integer string in **smallest token units** (no decimals) transferred to each new puzzle **`TARGET_ADDRESS`** when funding runs.
- **Example:** `1000000` for 1.0 tokens if mint uses 6 decimals.

### `ENCRYPTION_HKDF_SALT_HEX` (optional)
- **Purpose:** Extra HKDF salt as **hex** (minimum **16 hex characters** = 8 bytes if set). Strengthens key separation between deployments.
- **If unset:** implementation uses a fixed application salt string (documented in code when encryption lands).

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
4. tune HTTP rate limits and batch size only as needed

