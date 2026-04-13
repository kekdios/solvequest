# Implementation plan: Demo mode, registration, custodial Solana, admin auth

## Goals

1. **Anonymous demo**: Users land and use the app with the **free bonus QUSD** with **no registration** and **no Solana address**.
2. **Clear UI**: Header shows **“Demo”** when in demo mode.
3. **Demo persistence**: Account state and transaction history live **only in the browser** (existing local patterns: `localStorage` / IndexedDB as needed).
4. **Registration gate**: **Email + OTP** required to “unlock” real account features that need a **custodial deposit address**.
5. **Custodial Solana**: After successful OTP, the **backend** derives a **Solana address from a master key** you control (HD or indexed derivation), persists `user ↔ sol_receive_address`, and returns the public address to the client. **No client-side keypair** for users.
6. **Admin**: One or more **admin routes** protected by **Solana wallet authentication** (sign-in with wallet), not email OTP.

---

## Current state (baseline)

- App state (perps, QUSD vault, account) largely in React **reducer** + some **localStorage** (`accountReceiveAddresses`, deposit ledger, etc.).
- **Solana receive keypair** is created in the browser on load (`getOrCreateAccountReceiveWallet`) — **conflicts** with custodial + demo-only requirements.
- **No** email/OTP, **no** backend session, **no** admin area.

---

## Target architecture (high level)

| Layer | Responsibility |
|--------|----------------|
| **SPA (Vite/React)** | Demo mode UI; registered user UI; header badge; registration flow; **no** user private keys. |
| **API (Node on droplet or DO App Platform)** | Email OTP (send/verify), JWT/session cookie; derive Solana pubkey from **server-only** master seed; CRUD user profile; optional: deposit webhooks / sweep workers later. |
| **Postgres or SQLite** | Users (`id`, `email`, `email_verified_at`, `sol_receive_address`, `derivation_index` or path component), OTP challenges, admin allowlist. |
| **Secrets** | Master seed / HD root in **env or KMS**, never in repo or `VITE_*`. |

---

## Phase 1 — Demo mode (no registration, no Solana)

**Behavior**

- First visit → **demo session** initialized with same **bonus QUSD** and rules as today, stored under a **demo-specific** storage key (e.g. `sq-demo-session-v1`).
- Header: show **`Demo`** (and optionally “Register to save & deposit” CTA).
- **Do not** call `getOrCreateAccountReceiveWallet` or any custodial Solana UI while `authMode === 'demo'`.
- **Do not** show deposit address / custody panel in demo (or show disabled placeholder with copy).

**Engineering**

- Introduce `authMode: 'demo' | 'registered'` (or `null` loading) in app shell.
- Split persistence:
  - **Demo**: serialize reducer snapshot + perp tx log to `localStorage` (or IndexedDB if size grows).
  - Namespace keys so registered data never overwrites demo blindly.
- **Migration path** (Phase 3): optional “carry over demo balances to registered account” — product decision; if yes, define mapping rules (e.g. QUSD only, reset perps).

**Exit criteria**: User can refresh; demo state restores; header shows Demo; zero Solana key generation.

---

## Phase 2 — Registration (email OTP) + server-derived Solana address

**Flow**

1. User clicks **Register** → enter email → **Request OTP** (API sends email via SendGrid/Postmark/SES — pick one).
2. User submits OTP → API verifies → creates **user row** (or completes verification), derives **Solana deposit address**:
   - **Recommended**: HD path `m/44'/501'/<accountIndex>'/0'` from master seed (implementation with `ed25519-hd-key` + `@solana/web3.js` **on server only**).
   - Store **only** `sol_receive_address` (base58) and derivation index in DB; **never** return private key to client.
3. API returns **session JWT** (httpOnly cookie preferred) + `{ solReceiveAddress, userId }`.
4. SPA sets `authMode = 'registered'`, clears or archives demo local state per product rules, **hydrates** account from API (or merges demo → server if allowed).

**Engineering**

- Backend routes: `POST /auth/register/request-otp`, `POST /auth/register/verify-otp` (or combined with login).
- Rate-limit OTP; short TTL; constant-time compare.
- **Master key**: load from `MASTER_SEED` or `HD_ROOT_HEX` (64 bytes) in server env; document rotation/re-derivation policy.
- Replace browser `accountReceiveAddresses` usage for **registered** users with **API-fetched address** only.

**Exit criteria**: New user completes OTP; sees custodial address from server; no key material in frontend bundle.

---

## Phase 3 — Align existing features with modes

- **Account screen**: Deposit / custody **only** when registered; show registration prompt in demo.
- **Perps / loss caps**: Decide: **allowed in demo** (current product ask: yes, with bonus QUSD) vs server-synced state after registration — document in reducer persistence layer.
- **Custody monitor / sweep**: Run **server-side workers** with keys derived same as deposit (future phase); client can show **read-only** balance via API if needed.
- Remove or gate **`VITE_SOLANA_TEST_SECRET_KEY_B64`** paths for production builds.

---

## Phase 4 — Admin pages (Solana wallet auth)

**Behavior**

- Routes e.g. `/admin`, `/admin/users` **not** reachable without wallet proof.
- **Sign-In With Solana (SIWS)** pattern: server issues nonce; user signs with Phantom/Solflare; server verifies signature against **allowlisted** admin pubkeys (env `ADMIN_PUBKEYS` comma-separated).

**Engineering**

- `GET /admin/nonce` → `{ nonce, message }`
- `POST /admin/verify` → body: `{ pubkey, signature, message }` → session cookie **admin** role.
- SPA: **Wallet adapter** (`@solana/wallet-adapter-react`) only on **admin** bundle or lazy route to keep main app light for non-admin users.
- Middleware: reject if `pubkey` not in allowlist.

**Exit criteria**: Only allowlisted wallets access admin UI and APIs.

---

## Security checklist

- [ ] No custodial private keys in browser or `VITE_*`.
- [ ] Master seed only on server; backups encrypted; access logged.
- [ ] OTP rate limits; JWT httpOnly + CSRF strategy for cookie-based auth.
- [ ] Admin allowlist maintained in env or DB; no shared “password” for admin.
- [ ] HTTPS everywhere (Let’s Encrypt on droplet).

---

## Suggested implementation order

1. Phase 1 (Demo mode + header + no Solana in demo)  
2. Minimal API + DB + email OTP + HD derivation + JWT  
3. Phase 3 (wire Account, remove client keygen for registered users)  
4. Phase 4 (admin + SIWS)

---

## Open product decisions (fill in before build)

- [ ] On registration, **migrate** demo QUSD/balances to server or **reset**?
- [ ] Can demo users **trade perps** indefinitely or cap?
- [ ] **Email uniqueness**: one account per email; recovery flow?
- [ ] **Custodial deposits**: credit in-app balance via **server listener** only (recommended) vs any client-side polling after registration.

---

## File / area touch map (for later implementation)

| Area | Likely changes |
|------|----------------|
| `App.tsx` / layout | `authMode`, header “Demo” badge, route guards |
| `src/lib/accountReceiveAddresses.ts` | Deprecated for end users; optional dev-only; replaced by API for registered |
| `src/screens/AccountScreen.tsx` | Register CTA; hide custody until registered |
| New `src/auth/*` | OTP UI, session hooks |
| New `server/` or `api/` | OTP, JWT, HD derive, admin verify |
| `db/schema.sql` | `users`, `otp_challenges`, optional `admin_pubkeys` |

This document is the single source of truth for the agreed direction; update it as decisions are made.
