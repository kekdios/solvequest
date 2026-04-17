# Solve Quest

Web app for **perpetual-style trading** against Hyperliquid-derived index marks, **QUSD** balances (ledger-backed), **email (OTP) auth**, **Leaderboard** (top QUSD balances), and Solana flows: **buy QUSD** (USDC to your verified address → server credits QUSD), **swap** (QUSD → USDC from treasury to your verified address), and a **Prize** page (seasonal pool copy from **`PRIZE_AMOUNT`**). With a valid sign-in session, the SPA opens on **Trade**; without a session, it opens on **Home** (landing).

**Stack:** React 19 + Vite · Express (`server/index.ts`) · SQLite (`better-sqlite3`) · Solana (web3.js, SPL).

## Quick start

```bash
npm install
# Add .env at repo root (and optionally backend/.env) — see docs/SOLVEQUEST_OVERVIEW.md
npm run db:init        # creates data/solvequest.db from db/schema.sql
npm run dev            # API + Vite (dev API defaults to port 3001; Vite proxies /api)
```

After the app loads, use the in-app **Quick start** screen (sidebar) for a user-facing walkthrough of QUSD, **Trade**, and positions.

**Minimum env** for local auth/API: set **`JWT_SECRET`** (and email OTP variables if you use `/api/auth` — see `plugins/userAuthApiPlugin.ts`). Load order: **`.env`**, then **`backend/.env`** (see `server/loadEnv.ts`).

Optional **`ADMIN_EMAIL`**: when it matches the signed-in user’s email (case-insensitive), the **Visitors** sidebar item and `GET /api/admin/visitors` are enabled. Visitor rows are stored in SQLite (`visitors` table) via `POST /api/visitors/log` from the SPA.

## Scripts

| Command | Purpose |
|--------|---------|
| `npm run dev` | Concurrent API + Vite dev server |
| `npm run build` | Typecheck + production Vite build → `dist/` |
| `npm start` | Production: `NODE_ENV=production tsx server/index.ts` (serves `dist/` + APIs) |
| `npm run db:init` | Create/apply `db/schema.sql` to `data/solvequest.db` |
| `npm run db:migrate` | Prints reminder — use `db:init` for a fresh DB |
| `npm run db:provision` | Optional: seed account + signup ledger row |
| `npm run treasury:gen` | New treasury: prints server `.env` lines plus **Base58** + JSON for wallet import (wallets don’t use base64) |
| `npm run treasury:b64-to-wallet -- <B64>` | Turn existing `SOLANA_TREASURY_KEY_B64` into Base58 / JSON for wallets |
| `npm test` | Typecheck + Hyperliquid feed smoke script |

## Docs

- **[docs/SOLVEQUEST_OVERVIEW.md](docs/SOLVEQUEST_OVERVIEW.md)** — deployment, env, SQLite ledger, Solana (QUSD buy scan worker, QUSD→USDC swap API, prize config, treasury), droplet notes. Default production SSH (matches `scripts/deploy.sh`): **`ssh root@152.42.168.173`**.

## Repository

<https://github.com/kekdios/solvequest>