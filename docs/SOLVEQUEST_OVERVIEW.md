# Solve Quest — project overview & operations

This document describes what the **current** Solve Quest app does, how it is structured, where configuration lives, and how database / Solana / deploy pieces fit together.

**Scope:** This repository implements **trading UI, QUSD ledger, deposits, and auth**. Older docs or chat exports may describe unrelated legacy products; ignore those when reading this codebase.

---

## What the app is

- **Solve Quest** is a **single deployment**: a **Vite + React 19** SPA (`src/`) and an **Express** server (`server/index.ts`) that serves **`/api/*`**, proxies **Solana JSON-RPC** at **`/solana-rpc`**, and in production serves the **built static site** from **`dist/`** with SPA fallback.
- **Product surface**: landing, email OTP auth, **perpetual-style trading UI** (Hyperliquid-derived index marks), **QUSD** balances, **history** of closed perps, **Solana USDC → QUSD** deposit flow (custodial receive address + server-side crediting), and an **admin** area (wallet sign-in + optional deposit scan / custody tools).
- **Branding / public site**: production is commonly exposed at **`https://solvequest.io`** (DNS → your VPS; exact IP is **not fixed in code**—use DNS or your host’s dashboard).

---

## Repository layout (high level)

| Path | Role |
|------|------|
| `src/` | React UI, state, screens, wallet adapters |
| `server/` | Express entry (`index.ts`), `loadEnv`, deposit scan worker, Solana helpers |
| `plugins/` | HTTP middleware used in **dev** (Vite) and imported patterns; account/auth/admin APIs align with production server |
| `db/schema.sql` | **Authoritative** SQLite schema (single file; no incremental `db/migrations` folder in current tree) |
| `data/solvequest.db` | Default SQLite file (gitignored; created by `npm run db:init`) |
| `dist/` | Production frontend build output (`npm run build`) |
| `scripts/deploy.sh` | SSH deploy helper (git pull, `npm ci`/`install`, `npm run build`, `systemctl restart`) |
| `scripts/solvequest.service.example` | systemd unit sketch for the droplet |

---

## Environment files

Node loads env **before** other imports via `server/loadEnv.ts`:

1. **`<repo>/.env`**
2. **`<repo>/backend/.env`** (second file **overrides** duplicate keys from the first)

Vite (dev/build) also reads project `.env` / `.env.local` per Vite rules for **`VITE_*`** variables exposed to the browser.

**Do not commit real secrets.** Typical variables include:

| Area | Examples |
|------|----------|
| Auth | `JWT_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM_AUTH`, JWT expiry vars |
| Database | `SOLVEQUEST_DB_PATH` (optional; default `data/solvequest.db` under repo root) |
| Solana | `SOLANA_RPC_PROXY_TARGET` or `SOLANA_RPC_URL`, `SOLANA_TREASURY_ADDRESS` (server; treasury also exposed read-only via `GET /api/config/treasury`), optional `VITE_*` for client |
| Custodial HD master | **`SOLANA_CUSTODIAL_MASTER_KEY_B64`** (server-only) — used by **`server/custodialHdDerive.ts`** to derive deposit addresses (`m/44'/501'/<n>'/0'`). Legacy encrypted rows use the same env value for decryption. |
| Deposits | `QUSD_MULTIPLIER` / `VITE_QUSD_MULTIPLIER`, `SOLVEQUEST_DEPOSIT_SCAN` (background scan opt-in), **`SOLVEQUEST_CUSTODIAL_SWEEP`** (`1` / `true` = auto-sweep USDC to treasury after each scan in **`server/depositScanWorker.ts`**) |
| Sweep fee payer (optional) | **`SOLANA_SWEEP_FEE_PAYER_KEY_B64`** — server-only base64 **64-byte** raw secret key (export of a normal Solana keypair). **Or** set **`SOLANA_SWEEP_FEE_PAYER_FROM_MASTER=1`** with **`SOLANA_CUSTODIAL_MASTER_KEY_B64`** already set: the server derives a **dedicated** fee keypair at HD index **`1_000_000_000`** (reserved — never assigned to user accounts). Fund **that** derived pubkey with SOL. Precedence: explicit **`SOLANA_SWEEP_FEE_PAYER_KEY_B64`** wins if both are configured. Omit both and the flag to keep per-custodial fee payment. Admin UI (**signed in**): **`GET /api/admin/sweep-fee-payer-info`** shows the pubkey, path (when from master), and on-chain SOL balance. |
| Admin | `ADMIN_SOLANA_ADDRESS` (comma-separated allowed admin wallet pubkeys); optional **`SOLVEQUEST_ADMIN_CUSTODY_OWNER`** — mainnet base58 custodial **owner** pubkey used by **`POST /api/admin/custodial-sweep`** when no `account_id` body is sent (must match **`accounts.sol_receive_address`**) |
| Admin debug (optional) | `VITE_SOLANA_DEBUG_CUSTODY_PUBKEY` — mainnet pubkey for the admin Solana custody panel (read-only scan / balances); not a private key. |
| Server | `PORT` (production default often **3000** in code, but **systemd** may set e.g. **3001**—must match nginx) |

On the **droplet**, ensure the process **working directory** is the app root (e.g. `/opt/solvequest`) so `.env` / `backend/.env` resolve correctly.

---

## Deployment: droplet, IP, and DNS

Defaults below match **`scripts/deploy.sh`** and **`scripts/solvequest.service.example`**. If you deploy to another host, directory, or unit name, set **`DEPLOY_TARGET`**, **`APP_DIR`**, **`SERVICE_NAME`** (see `deploy.sh`) and substitute those values anywhere this doc uses the defaults.

| Item | Value in repo defaults |
|------|-------------------------|
| SSH (deploy) | `root@152.42.168.173` |
| App directory | `/opt/solvequest` |
| systemd unit | `solvequest` |
| Node listen port (example unit) | `3001` (`Environment=PORT=3001`) |
| Public health URL (deploy check) | `https://solvequest.io/health` |

- **Process**: `NODE_ENV=production` + `tsx server/index.ts` (see `scripts/solvequest.service.example`). **nginx** (or similar) usually terminates TLS and reverse-proxies to `127.0.0.1:PORT` (must match **`PORT`** in the unit).

---

## SQLite database

- **Default path**: `<repo>/data/solvequest.db`.
- **Override**: `SOLVEQUEST_DB_PATH=/absolute/path/to/file.db`.
- **Create / reset**: `npm run db:init` runs `scripts/init-db.mjs` which executes **`db/schema.sql`** only.
- **Small additive migrations**: On API startup the server runs **`ensureCustodialHdSchema`** (adds **`custodial_derivation_index`** + index if missing). You can also run **`npm run db:migrate-hd`** (`scripts/migrate-custodial-hd.ts`) manually on the same DB path. For a corrupt or unknown-old schema, **back up, delete the DB file**, then `db:init` is still the clean reset. `npm run db:migrate` (migrate-all) only prints guidance — it does not alter schema.

### Schema concepts

- **`accounts`**: profile, coverage stats, `sync_version`, **`sol_receive_address`**, **`custodial_derivation_index`** (HD deposit path index), optional legacy **`custodial_seckey_enc`** (decrypt-only for older rows). Legacy columns **`vault_activity_at`** and **`qusd_vault_interest_at`** may exist on older DBs but are unused — **not** raw QUSD columns; balances come from the ledger.
- **`qusd_ledger`**: append-only rows (`unlocked_delta`, `locked_delta`). The API merges **unlocked + locked** into a single spendable QUSD balance for clients; legacy **`vault_interest`** rows remain in historical data only.
- **`perp_open_positions` / `perp_transactions`**: open positions and closed trade history.
- **`deposit_credits`**, **`deposit_scan_state`**: on-chain deposit idempotency and scan watermarks.

### Server SQLite settings (implementation detail)

- API and workers use **WAL** + **busy_timeout** to reduce lock errors when the deposit worker and HTTP API touch the same file.

### Production droplet: delete SQLite and recreate (fresh DB)

Use this when the server DB is corrupt, locked, or inconsistent and you accept **losing all server-side account data** (ledger, positions, deposit idempotency rows, custodial metadata). Defaults: **`root@152.42.168.173`**, **`/opt/solvequest`**, unit **`solvequest`**, DB file **`/opt/solvequest/data/solvequest.db`**.

1. **SSH**  
   `ssh root@152.42.168.173`

2. **Stop the app** (releases SQLite locks)  
   `sudo systemctl stop solvequest`  
   Confirm: `systemctl is-active solvequest` prints `inactive`.

3. **Resolve the DB path** (default vs `SOLVEQUEST_DB_PATH`)  
   ```bash
   grep -E '^SOLVEQUEST_DB_PATH=' /opt/solvequest/.env /opt/solvequest/backend/.env 2>/dev/null || true
   ```  
   - If **no** `SOLVEQUEST_DB_PATH`: use **`/opt/solvequest/data/solvequest.db`**.  
   - If set: use that **absolute** path for the next steps (and its `-wal` / `-shm` siblings).

4. **Optional backup** (skip if the file is unusable)  
   `sudo cp /opt/solvequest/data/solvequest.db "/root/solvequest-backup-$(date +%Y%m%d%H%M).db"`

5. **Remove DB + WAL files**  
   ```bash
   sudo rm -f /opt/solvequest/data/solvequest.db \
              /opt/solvequest/data/solvequest.db-wal \
              /opt/solvequest/data/solvequest.db-shm
   ```  
   If `SOLVEQUEST_DB_PATH` points elsewhere, delete **that** base path and the same basename with `-wal` and `-shm` appended.

6. **Recreate from schema**  
   ```bash
   cd /opt/solvequest
   npm run db:init
   ```  
   Ensure the new file is writable by whatever **`User=`** runs the service (`scripts/solvequest.service.example` uses **`User=root`**).

7. **Start the app**  
   `sudo systemctl start solvequest`  
   Local health (port from unit; default **3001**):  
   `curl -fsS http://127.0.0.1:3001/health`  
   After start, wait ~2s or for **`[server] listening`** in logs before **`curl`** (immediate **`curl`** can race startup).

8. **Aftereffects**  
   All accounts and balances on that DB are gone; users re-register. Env secrets (e.g. **`JWT_SECRET`**) are unchanged unless you edit them.

#### Copy-paste reset (default DB only — no IP or paths to fill in)

Use this **only if** neither `/opt/solvequest/.env` nor `/opt/solvequest/backend/.env` sets **`SOLVEQUEST_DB_PATH`** (or you cleared it). If `grep` in step 2 shows a custom path, stop and use the numbered steps above instead.

**Step 1 — on your laptop:** connect.

```bash
ssh root@152.42.168.173
```

**Step 2 — on the server:** stop app and confirm nothing overrides the DB path.

```bash
sudo systemctl stop solvequest
grep -E '^SOLVEQUEST_DB_PATH=' /opt/solvequest/.env /opt/solvequest/backend/.env 2>/dev/null || echo "OK: default path"
```

If you see a line like `SOLVEQUEST_DB_PATH=/something/else.db`, do **not** run step 3 as written; use the custom path for `rm` and `db:init`’s working directory as in § “Production droplet” steps 5–6.

**Step 3 — on the server:** remove the default DB and WAL files.

```bash
sudo rm -f /opt/solvequest/data/solvequest.db /opt/solvequest/data/solvequest.db-wal /opt/solvequest/data/solvequest.db-shm
```

**Step 4 — on the server:** recreate from `db/schema.sql`.

```bash
cd /opt/solvequest && npm run db:init
```

**Step 5 — on the server:** start and verify.

```bash
sudo systemctl start solvequest
curl -fsS http://127.0.0.1:3001/health
```

After **`systemctl start`**, wait ~2s or until **`journalctl -u solvequest -n 10`** shows **`[server] listening`** before **`curl`** — an immediate **`curl`** can run before Node accepts connections.

---

## Solana integration

- **Browser RPC**: defaults to **same-origin** `/solana-rpc` so providers that reject browser `Origin` on public mainnet are avoided; Express proxies to **`SOLANA_RPC_PROXY_TARGET`** (default mainnet-beta) and strips Origin on the upstream request.
- **Treasury**: sweeps use a treasury **pubkey** from env (`SOLANA_TREASURY_ADDRESS` / `VITE_SOLANA_TREASURY_ADDRESS`); **`GET /api/config/treasury`** exposes the configured address for the admin UI without requiring a Vite rebuild.
- **Deposits (worker)**: USDC SPL to the account’s receive ATA is detected by **`server/depositScanWorker.ts`** + **`server/solanaUsdcScan.ts`** (optional background polling via **`SOLVEQUEST_DEPOSIT_SCAN`**, or **`POST /api/admin/deposit-scan`**). Parsed txs credit **`deposit_credits`** and **`qusd_ledger`** (via **`server/qusdLedger.ts`**). Implementation notes:
  - **First scan** (no row in **`deposit_scan_state`** or null watermark): the worker **paginates** signatures on the USDC ATA and credits inbound USDC **oldest → newest** (so a fresh DB or reset still picks up existing on-chain history).
  - **Stuck watermark**: if **`deposit_credits`** sum is ~0 but the custodial ATA still holds USDC, the worker **clears** **`deposit_scan_state`** for that account and rescans (fixes the legacy case where a watermark advanced without credits).
  - **Parsing**: inbound USDC is detected from meta **pre/post token balances**, matching the wallet’s USDC **ATA** by **`accountIndex`** when possible, else by **`owner`** (see **`usdcNetChangeForWallet`** in **`server/solanaUsdcScan.ts`**).
- **Custodial sweep**: **`server/custodialSweepServer.ts`** moves USDC (+ optional excess SOL above a buffer) from the custodial keypair to the treasury. Triggered by **`SOLVEQUEST_CUSTODIAL_SWEEP`** after deposit scan, or manually via admin **guided sweep** (**`POST /api/admin/custodial-sweep`**, body optional **`{ "account_id": "<uuid>" }`**, implemented in **`server/adminCustodialSweepOrchestrator.ts`**). Optional central fee payment: **`SOLANA_SWEEP_FEE_PAYER_KEY_B64`** or **`SOLANA_SWEEP_FEE_PAYER_FROM_MASTER`** (derive from master — see env table). Custodial keys still **authorize** transfers. If none of these are used, **native SOL** on each **`sol_receive_address`** pays fees as before. **`SendTransactionError`** from the RPC is caught and surfaced with simulation logs when available.
- **Custodial deposit addresses (current)**: After sign-in, **`POST /api/account/ensure-custodial-deposit`** assigns the next **`custodial_derivation_index`**, derives the keypair with **`server/custodialHdDerive.ts`** (SLIP-0010 style path `m/44'/501'/<n>'/0'`), and stores **`sol_receive_address`** (base58). The SPA does **not** generate user deposit keypairs. Signing for sweeps uses **`server/depositWalletCrypto.ts`** → **`resolveCustodialDepositKeypair`**: either legacy **`custodial_seckey_enc`** decryption or **re-derivation** from index + master env.
- **CLI provisioning**: **`npm run db:provision`** runs **`tsx scripts/provision-account.ts`** — inserts a test account row with the **next** HD index and signup grant (same derivation rules as the API).

---

## Auth & sync

- **Users**: email OTP via **Resend** + **JWT** cookie (`auth_token`).
- **Account state**: client **`PUT /api/account/state`** with optimistic locking on **`sync_version`**.
- **Admin**: separate cookie session; **Solana** message sign against **`ADMIN_SOLANA_ADDRESS`**.

---

## Issues resolved (historical context)

Useful when comparing to older notes or chats:

| Topic | Resolution |
|-------|------------|
| QUSD balances | Moved to **ledger** (`qusd_ledger`); signup grant + perp margin/close + deposits; legacy locked/unlocked columns merged for display. |
| Legacy vault lock / interest | Removed from product; historical **`vault_interest`** ledger rows may remain. |
| Client sync / rapid closes | **Ack** only closes included in each successful PUT; sync effect deps avoid mark ticks resetting timers; faster debounce when closes pending. |
| SQLite locking | **WAL** + **busy_timeout** on API and deposit paths. |
| Legacy migration scripts | **`db/schema.sql` + `db:init`** for fresh DBs; **`npm run db:migrate-hd`** for additive HD column; `npm run db:migrate` prints guidance only. |
| Browser-generated deposit keys | Removed; deposit addresses come from the server (**HD** + `ensure-custodial-deposit`). |
| Treasury in admin UI | **`/api/config/treasury`** reads **`SOLANA_TREASURY_ADDRESS`** on the server. |
| Stale error copy | User-facing messages updated to point at **`db:init`** instead of removed `db:migrate:*` scripts. |

---

## Quick commands

```bash
# Development
npm run dev          # API + Vite concurrently

# Production build
npm run build        # tsc + vite build → dist/

# Database
npm run db:init         # create DB from db/schema.sql (default data/solvequest.db)
npm run db:migrate-hd   # add custodial_derivation_index to an existing DB (safe to re-run)
npm run db:provision    # insert one provisioned account + HD deposit row (needs master key in env)

# Deploy from laptop (default host in deploy.sh: root@152.42.168.173)
./scripts/deploy.sh
# or: DEPLOY_TARGET=root@OTHER ./scripts/deploy.sh root@OTHER
```

**Deploy note:** `deploy.sh` runs **`npm run build`** only; it does **not** run **`db:init`**. The **`custodial_derivation_index`** column is added **automatically** when the API process opens SQLite (same as `npm run db:migrate-hd`). For a brand-new host, ensure the DB file exists and has a full schema (**`db:init`** on the server) or restore a backup; additive HD migration alone does not create missing tables.

---

## Reviewing archived “website replacement” exports

Exports such as **`cursor_website_replacement_recommendati.md`** may discuss merging another frontend repo (**e.g. `/Users/private/insured`**) with Express and env layout. The **current** tree is already **React + Express** in one project. Use this file as the description of **today’s** layout. Ignore product assumptions in those exports that don’t match perps + QUSD + deposits.
