# Implementation plan: Demo mode, registration, user-verified Solana

> **Note:** Wallet-based **trading** admin routes were **removed**. **Visitor** analytics uses **`ADMIN_EMAIL`** + **`GET /api/admin/visitors`** (see `plugins/visitorsApiPlugin.ts`). Server-side **user** HD deposit generation and custodial USDC sweep were **removed**; deposit scan credits QUSD from the user’s verified **`sol_receive_address`**.

## Goals

1. **Anonymous demo**: Users land and use the app with the **free bonus QUSD** with **no registration** and **no Solana address**.
2. **Clear UI**: The header shows **“Demo”** when in demo mode.
3. **Demo persistence**: Account state and transaction history live **only in the browser** (`localStorage` / demo-specific keys as implemented).
4. **Registration gate**: **Email + OTP** required for server-backed account features.
5. **Solana deposit address**: User links **their own** wallet via **`POST /api/account/verify-solana-address`**; the server stores **`sol_receive_address`** and does **not** generate user keys.
6. **Signed-in entry**: With a valid JWT session, the SPA opens on **Trade** after auth resolves (see `App.tsx`); **Home** remains available from the sidebar.

---

## Current state (baseline)

- App state (perps, QUSD, account) in React **reducer** with demo persistence and server sync for registered users.
- **Deposit addresses**: user-verified only (`plugins/accountApiPlugin.ts`). Optional legacy **`custodial_*`** columns may exist in older SQLite files.
- Email/OTP and backend session (see `src/auth`, `plugins/`, `server/`).

---

## Target architecture (high level)

| Layer | Responsibility |
|--------|----------------|
| **SPA (Vite/React)** | Demo mode UI; registered user UI; **no** user private keys in the bundle. |
| **API (Node)** | Email OTP, JWT/session cookie; account CRUD; optional QUSD buy scan worker (`server/qusdBuyScanWorker.ts`). |
| **SQLite** | `accounts` (`sol_receive_address`, …), QUSD ledger, deposit idempotency, perp tables. |
| **Secrets** | **`SOLANA_TREASURY_ADDRESS`** + **`SOLANA_TREASURY_KEY_B64`** for treasury signing (QUSD → USDC swap sends). Optional **`SOLANA_CUSTODIAL_MASTER_KEY_B64`** only if you derive treasury via HD instead of `SOLANA_TREASURY_KEY_B64`. User deposit keys are never held by the server. |
| **Swap QUSD→USDC** | **`SWAP_ABOVE_AMOUNT`** sets a QUSD floor: only **`min(entered, balance) − floor`** converts at **`SWAP_QUSD_USDC_RATE`** (see `src/lib/swapAmounts.ts`, `plugins/swapApiPlugin.ts`). |

---

## Phase 3 — Deposits

- **Account screen**: Deposit UI when registered; user verifies Solana address.
- **Server**: `server/qusdBuyScanWorker.ts` — optional **`SOLVEQUEST_DEPOSIT_SCAN`** background polling.

---

## Security checklist

- [ ] No user private keys in browser bundles; avoid real secrets in `VITE_*` for production.
- [ ] OTP rate limits; secure cookies / CSRF as appropriate.
- [ ] HTTPS in production.

---

## File / area touch map (reference)

| Area | Likely changes |
|------|----------------|
| `App.tsx` / layout | Demo badge, account hydrate |
| `src/screens/AccountScreen.tsx` | Register CTA; verify Solana address |
| `plugins/accountApiPlugin.ts` | `/api/account/me`, verify-solana-address |
| `server/qusdBuyScanWorker.ts` | USDC → QUSD crediting |
| `server/solanaHdDerive.ts` | Optional HD for treasury pubkey resolution |
| `db/schema.sql` | `accounts`, ledger, deposit tables |

Update this document as product and deployment decisions change.
