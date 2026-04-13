# Solve Quest — project overview & operations

This document describes what the **current** Solve Quest app does, how it is structured, where configuration lives, and how database / Solana / deploy pieces fit together.

**Scope:** This repository implements **trading UI, QUSD ledger, deposits, and auth**. Older docs or chat exports may describe unrelated legacy products; ignore those when reading this codebase.

---

## What the app is

- **Solve Quest** is a **single deployment**: a **Vite + React 19** SPA (`src/`) and an **Express** server (`server/index.ts`) that serves **`/api/*`**, proxies **Solana JSON-RPC** at **`/solana-rpc`**, and in production serves the **built static site** from **`dist/`** with SPA fallback.
- **Product surface**: landing, email OTP auth, **perpetual-style trading UI** (Hyperliquid-derived index marks), **QUSD** balances, optional **vault** lock/unlock, **history** of closed perps, **Solana USDC → QUSD** deposit flow (custodial receive address + server-side crediting), and an **admin** area (wallet sign-in + optional deposit scan / custody tools).
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
| Deposits | `QUSD_MULTIPLIER` / `VITE_QUSD_MULTIPLIER`, `SOLVEQUEST_DEPOSIT_SCAN` (background scan opt-in), custodial sweep flags |
| Admin | `ADMIN_SOLANA_ADDRESS` (comma-separated allowed admin pubkeys) |
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
- **“Migrations”**: there are **no** chained migration scripts in this branch; old DBs should be **backed up and replaced**, then `db:init`, unless you hand-patch (not recommended).

### Schema concepts

- **`accounts`**: profile, coverage stats, `sync_version`, Solana receive + optional **encrypted custodial** key, vault timestamps — **not** raw QUSD columns; balances come from the ledger.
- **`qusd_ledger`**: append-only rows (`unlocked_delta`, `locked_delta`); **display** unlocked/locked = `SUM` of deltas.
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
- **Treasury**: sweeps use a treasury **pubkey** from env; **`GET /api/config/treasury`** exposes the configured address for the admin UI without requiring a Vite rebuild.
- **Deposits**: USDC SPL to the account’s receive ATA is detected by **`server/depositScanWorker.ts`** (optional background polling via env, or admin-triggered scan). Credits append **`qusd_ledger`** and **`deposit_credits`**.
- **Custodial keys**: stored encrypted on the account row when using server-generated deposit addresses (`ensure-custodial-deposit` flow).

---

## Auth & sync

- **Users**: email OTP via **Resend** + **JWT** cookie (`auth_token`).
- **Account state**: client **`PUT /api/account/state`** with optimistic locking on **`sync_version`**.  
  - Vault interest is **not** applied on that write path (avoids spurious **`sync_version`** bumps before the UPDATE).
- **Admin**: separate cookie session; **Solana** message sign against **`ADMIN_SOLANA_ADDRESS`**.

---

## Issues resolved (historical context)

Useful when comparing to older notes or chats:

| Topic | Resolution |
|-------|------------|
| QUSD balances | Moved to **ledger** (`qusd_ledger`); signup grant + perp margin/close + deposits + conserved vault moves only. |
| Blind “reconcile” vault moves | Restricted to **unlocked+locked conserved** shuffles (`du + dl ≈ 0`) so bad client totals don’t mint QUSD. |
| Client sync / rapid closes | **Ack** only closes included in each successful PUT; sync effect deps avoid mark ticks resetting timers; faster debounce when closes pending. |
| `PUT` + vault interest | **`loadOrCreateRow(..., { skipInterest: true })`** for state writes so interest doesn’t bump `sync_version` before the optimistic lock. |
| SQLite locking | **WAL** + **busy_timeout** on API and deposit paths. |
| Legacy migration scripts | Removed in favor of **`db/schema.sql` + `db:init`**; `npm run db:migrate` prints guidance only. |
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
npm run db:init      # create DB from db/schema.sql (default data/solvequest.db)

# Deploy from laptop (default host in deploy.sh: root@152.42.168.173)
./scripts/deploy.sh
# or: DEPLOY_TARGET=root@OTHER ./scripts/deploy.sh root@OTHER
```

---

## Reviewing archived “website replacement” exports

Exports such as **`cursor_website_replacement_recommendati.md`** may discuss merging another frontend repo (**e.g. `/Users/private/insured`**) with Express and env layout. The **current** tree is already **React + Express** in one project. Use this file as the description of **today’s** layout. Ignore product assumptions in those exports that don’t match perps + QUSD + deposits.
