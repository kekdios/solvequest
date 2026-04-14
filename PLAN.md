# Implementation plan: Demo mode, registration, custodial Solana, admin auth

## Goals

1. **Anonymous demo**: Users land and use the app with the **free bonus QUSD** with **no registration** and **no Solana address**.
2. **Clear UI**: Header shows **“Demo”** when in demo mode.
3. **Demo persistence**: Account state and transaction history live **only in the browser** (`localStorage` / demo-specific keys as implemented).
4. **Registration gate**: **Email + OTP** required to “unlock” real account features that need a **custodial deposit address**.
5. **Custodial Solana**: After successful OTP, the **backend** derives a **Solana address from a master key** (HD path `m/44'/501'/<n>'/0'`), persists `sol_receive_address` + `custodial_derivation_index`, and returns the public address to the client. **No client-side keypair** for users.
6. **Admin**: One or more **admin routes** protected by **Solana wallet authentication** (sign-in with wallet), not email OTP.

---

## Current state (baseline)

- App state (perps, QUSD vault, account) in React **reducer** with demo persistence and server sync for registered users. **Vault yield**: ~**1% per day** on **locked** QUSD (`src/engine/qusdVault.ts`); demo applies per-minute increments in-browser; production applies **compound** accrual on **`GET /api/account/me`** via **`plugins/vaultInterest.ts`** → ledger rows **`vault_interest`**, using **`accounts.qusd_vault_interest_at`** (see **`docs/SOLVEQUEST_OVERVIEW.md`**).
- **Deposit addresses**: server-only HD derivation (`server/custodialHdDerive.ts`, `POST /api/account/ensure-custodial-deposit`); SQLite stores `sol_receive_address` and `custodial_derivation_index`. Legacy rows may still have `custodial_seckey_enc` (decrypt-only path in `server/depositWalletCrypto.ts`).
- **No** browser-generated Solana deposit keypairs for end users.
- Email/OTP, backend session, and admin flows exist as implemented in-repo (see `src/auth`, `plugins/`, `server/`).

---

## Target architecture (high level)

| Layer | Responsibility |
|--------|----------------|
| **SPA (Vite/React)** | Demo mode UI; registered user UI; header badge; registration flow; **no** user private keys. |
| **API (Node)** | Email OTP (send/verify), JWT/session cookie; HD-derived Solana pubkey; account CRUD; deposit scan / sweep workers. |
| **SQLite** | `accounts` (`sol_receive_address`, `custodial_derivation_index`, …), QUSD ledger, deposit idempotency, perp tables. |
| **Secrets** | Master key material in **server env** (`SOLANA_CUSTODIAL_MASTER_KEY_B64` preferred); avoid shipping real secrets in `VITE_*` bundles. |

---

## Phase 1 — Demo mode (no registration, no Solana)

**Behavior**

- First visit → **demo session** initialized with bonus QUSD, stored under a **demo-specific** storage key.
- Header: show **`Demo`** (and optionally “Register to save & deposit” CTA).
- **Do not** show a real custodial deposit address or browser custody tooling in demo (or show disabled placeholder).

**Engineering**

- `authMode: 'demo' | 'registered'` (or equivalent) in app shell.
- Split persistence so demo and registered data do not blindly overwrite each other.

**Exit criteria**: User can refresh; demo state restores; header shows Demo; no Solana deposit key material in the browser.

---

## Phase 2 — Registration (email OTP) + server-derived Solana address

**Flow**

1. User registers → OTP → session cookie / JWT.
2. **`POST /api/account/ensure-custodial-deposit`** assigns the next HD index, stores `sol_receive_address` + `custodial_derivation_index`, returns pubkey + USDC ATA info to the client.
3. SPA hydrates account from **`GET /api/account/me`** — **no** private keys in the bundle.

**Exit criteria**: Registered user sees custodial address from the server only; HD derivation stays server-side.

---

## Phase 3 — Align existing features with modes

- **Account screen**: Deposit UI when registered; registration prompt in demo.
- **Custody / sweep**: Server-side (`server/depositScanWorker.ts`, `server/custodialSweepServer.ts`); optional admin triggers.

---

## Phase 4 — Admin pages (Solana wallet auth)

**Behavior**

- Admin routes require wallet proof (SIWS-style nonce + signature).
- Allowlisted admin pubkeys via env (e.g. `ADMIN_SOLANA_ADDRESS` / related config in-repo).

**Engineering**

- Wallet adapter on admin routes; server verifies signatures.

---

## Security checklist

- [ ] No custodial private keys in browser bundles; avoid real secrets in `VITE_*` for production.
- [ ] Master key only on server; backups and rotation policy documented.
- [ ] OTP rate limits; secure cookies / CSRF as appropriate.
- [ ] Admin allowlist in env or DB.
- [ ] HTTPS in production.

---

## Suggested implementation order

1. Harden demo vs registered UX and persistence boundaries.  
2. Keep server HD + deposit pipeline as source of truth for addresses.  
3. Wire account UI and optional demo → registered migration rules.  
4. Harden admin auth and operational tooling.

---

## Open product decisions (fill in before build)

- [ ] On registration, **migrate** demo QUSD/balances to server or **reset**?
- [ ] Can demo users **trade perps** indefinitely or cap?
- [ ] **Email uniqueness**: one account per email; recovery flow?
- [ ] **Custodial deposits**: credit in-app balance via **server listener** only (recommended).

---

## File / area touch map (reference)

| Area | Likely changes |
|------|----------------|
| `App.tsx` / layout | Demo badge, route guards, account hydrate |
| `src/screens/AccountScreen.tsx` | Register CTA; deposit when registered |
| `src/auth/*` | OTP UI, session hooks |
| `server/custodialHdDerive.ts`, `plugins/accountApiPlugin.ts` | HD deposit assignment, `/api/account/me` |
| `server/depositScanWorker.ts` | USDC → QUSD crediting |
| `db/schema.sql` | `accounts`, ledger, deposit tables |

Update this document as product and deployment decisions change.
