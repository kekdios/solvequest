# SolveQuest PoC

Competition backend with **Redis** (optional in-memory fallback), **atomic claims**, **Solana signatures**, **batch validation + credits**, and **SSE** (Redis pub/sub when Redis is enabled).

## Quick start

```bash
cd backend
cp .env.example .env
npm install
npm test
node server.js
```

Set **`REDIS_URL`** for persistence and horizontal scaling. Without it, the process uses **in-memory** state (dev only).

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

### API keys + batch credits

**USDC mental model (Solana-only):** use **USDC** as the stable unit when you set prices — same **6 decimals** as SPL **USDC** on Solana (**1 USDC = 1_000_000** smallest units). Recommended: set **`CREDITS_SCALE_UNITS=1000000`** and treat **`credits_micro`** in Redis as **USDC base units**, so a confirmed on-chain USDC deposit can **`HINCRBY`** the same integer you see in a wallet explorer. **`BATCH_CREDIT_BASE`** / **`BATCH_CREDIT_UNIT`** are then **USDC amounts** (e.g. **`0.01`** = one cent per mnemonic when **`UNIT`** applies per item). The default **`CREDITS_SCALE_UNITS=1000`** in code is a generic “milli-credit” scale; switch to **`1000000`** when you want **1:1** parity with USDC micro-units.

- Header **`x-api-key`** on **`POST /validate_batch`** (optional). Invalid key → **401** before batch size checks.
- **Free (no key):** max batch **`FREE_TIER_BATCH_MAX`** (default **50**), concurrency **`FREE_TIER_BATCH_CONCURRENCY`** (default **8**).
- **Paid key (`tier paid`):** **`PAID_TIER_BATCH_MAX`** (default **1000**), **`PAID_TIER_BATCH_CONCURRENCY`** (default **32**).
- **Cost:** **`BATCH_CREDIT_BASE + n * BATCH_CREDIT_UNIT`** in *human* credits; billed as **integer micro-units** (**`CREDITS_SCALE_UNITS`**, default **1000** = 1.000 credits). Redis field **`credits_micro`** (**`HINCRBY`**); legacy **`credits`** (float) is migrated on first debit. Insufficient credits → **402**.
- Without Redis: optional **`API_KEYS_JSON`**: use **`credits_micro`** or **`credits`** (converted × scale).
- With Redis: **`HSET apikey:<key> credits_micro <n> tier paid`** (micro-units), or legacy **`credits`** for migration.

### Puzzle metadata

- **`GET /puzzle`** includes **`difficulty`**, **`round_id`**, **`round_end_ms`**, **`round_active`**, **`round_phase`**, settlement fields (see Timed rounds).

### SSE across instances

- With **Redis**: events are **`PUBLISH arena:events`**; each instance **subscribes** and pushes to its local SSE clients (no double delivery on the publishing node).
- Without Redis: local broadcast only.
- Structured types include **`attempt`**, **`leaderboard_update`** (with **`top`** preview), **`round_end`**, **`round_settled`** ( **`leaderboard_winner`**, **`puzzle_winner`** ), plus existing **`claim`** / **`submit`** / **`win`**.

---

## API summary

| Endpoint | Notes |
|----------|--------|
| `POST /claim` | Body: `mnemonic`, `pubkey`, `signature` (base58), signed `message` (binding + optional round; see above) |
| `POST /validate_batch` | Optional `x-api-key`; credits = `BATCH_CREDIT_BASE + n * BATCH_CREDIT_UNIT` |
| `GET /stats` | Counters + `attempts_per_sec`, `valid_rate`, arena time |
| `GET /leaderboard` | `?limit=&wallet=` → `{ top, self? }` |
| Others | See earlier phases (`/validate`, `/submit`, `/puzzle`, …) |

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
| `apikey:{key}` | Credits + tier |
| `arena:events` | Pub/sub channel for SSE fan-out |

---

## Operational notes

- **Horizontal scaling**: require **Redis**; point all instances at the same **`REDIS_URL`**.
- **Pricing (USDC):** tune **`BATCH_CREDIT_BASE`** / **`BATCH_CREDIT_UNIT`** in USDC; fund keys by incrementing **`credits_micro`** from on-chain USDC deposits (no fiat).
