# Solve Quest

Web app for **perpetual-style trading** against Hyperliquid-derived index marks, **QUSD** balances (ledger-backed), optional **vault** lock/unlock, **email (OTP) auth**, **Solana USDC → QUSD** deposits, and an **admin** area (wallet sign-in, deposit tooling).

**Stack:** React 19 + Vite · Express (`server/index.ts`) · SQLite (`better-sqlite3`) · Solana (web3.js, SPL).

## Quick start

```bash
npm install
# Add .env at repo root (and optionally backend/.env) — see docs/SOLVEQUEST_OVERVIEW.md
npm run db:init        # creates data/solvequest.db from db/schema.sql
npm run dev            # API + Vite (dev API defaults to port 3001, Vite proxies /api)
```

Minimum env for local auth/API: set **`JWT_SECRET`** (and email OTP vars if you use `/api/auth` — see `plugins/userAuthApiPlugin.ts`). Load order: **`.env`** then **`backend/.env`** (see `server/loadEnv.ts`).

## Scripts

| Command | Purpose |
|--------|---------|
| `npm run dev` | Concurrent API + Vite dev server |
| `npm run build` | Typecheck + production Vite build → `dist/` |
| `npm start` | Production: `NODE_ENV=production tsx server/index.ts` (serves `dist/` + APIs) |
| `npm run db:init` | Create/apply `db/schema.sql` to `data/solvequest.db` |
| `npm run db:migrate` | Prints reminder — use `db:init` for a fresh DB |
| `npm run db:provision` | Optional: seed account + signup ledger row |
| `npm test` | Typecheck + Hyperliquid feed smoke script |

## Docs

- **[docs/SOLVEQUEST_OVERVIEW.md](docs/SOLVEQUEST_OVERVIEW.md)** — deployment, env, SQLite ledger, Solana, droplet notes. Default production SSH (matches `scripts/deploy.sh`): **`ssh root@152.42.168.173`**.

## Repository

<https://github.com/kekdios/solvequest>