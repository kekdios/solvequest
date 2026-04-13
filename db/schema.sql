-- Solve Quest — SQLite schema
-- Persisted fields match engine Account + app vault state (no computed equity / uPnL / marks).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- Optional display label (engine uses userId string; this row’s `id` is the canonical user/account id)
  label TEXT,
  -- Login email (unique when set) — links JWT session to this row
  email TEXT,
  -- Engine Account — stored, not derived
  usdc_balance REAL NOT NULL,
  coverage_limit_qusd REAL NOT NULL,
  premium_accrued_usdc REAL NOT NULL DEFAULT 0,
  covered_losses_qusd REAL NOT NULL DEFAULT 0,
  coverage_used_qusd REAL NOT NULL DEFAULT 0,
  -- Account tier (1 / 2 / 3); coverage_limit_qusd is authoritative after tier + cap extensions
  tier_id INTEGER NOT NULL CHECK (tier_id IN (1, 2, 3)),
  -- QUSD vault (app state)
  qusd_unlocked REAL NOT NULL DEFAULT 0,
  qusd_locked REAL NOT NULL DEFAULT 0,
  -- Cumulative realized perp loss notionals tracked in app reducer
  accumulated_losses_qusd REAL NOT NULL DEFAULT 0,
  -- Bonus repayment progress (Send unlock); synced from client for registered users
  bonus_repaid_usdc REAL NOT NULL DEFAULT 0,
  -- Last vault lock/unlock activity (cooldown); epoch ms or NULL
  vault_activity_at INTEGER,
  -- Minute-boundary checkpoint for compounding interest on qusd_locked (epoch ms); server + demo client
  qusd_vault_interest_at INTEGER,
  -- Deposit address (assigned at account creation; sync from app / provision script)
  sol_receive_address TEXT,
  -- Optimistic concurrency: incremented on PUT /api/account/state and on-chain deposit credits
  sync_version INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_accounts_updated ON accounts (updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email ON accounts (email) WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_sol_receive_unique
  ON accounts (sol_receive_address)
  WHERE sol_receive_address IS NOT NULL AND TRIM(sol_receive_address) != '';

-- On-chain USDC deposit audit (server worker inserts; UNIQUE(chain, signature) is global idempotency).
CREATE TABLE IF NOT EXISTS deposit_credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  chain TEXT NOT NULL CHECK (chain IN ('solana')),
  signature TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('usdc', 'sol')),
  amount_human REAL,
  lamports INTEGER,
  credited_at INTEGER NOT NULL,
  UNIQUE (chain, signature)
);

CREATE INDEX IF NOT EXISTS idx_deposit_credits_account ON deposit_credits (account_id);

CREATE TABLE IF NOT EXISTS deposit_scan_state (
  account_id TEXT PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  watermark_signature TEXT
);

-- Append-only perp events: one row per open; one row per close (same position_id).
CREATE TABLE IF NOT EXISTS perp_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  position_id TEXT NOT NULL,
  txn_type TEXT NOT NULL CHECK (txn_type IN ('open', 'close')),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('long', 'short')),
  -- Open (required when txn_type = 'open'; optional echo on 'close' if you duplicate for audit)
  entry_price REAL,
  notional_usdc REAL,
  leverage REAL,
  margin_usdc REAL,
  opened_at INTEGER,
  -- Close (required when txn_type = 'close')
  exit_price REAL,
  realized_pnl_qusd REAL,
  closed_at INTEGER,
  inserted_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_perp_txn_account ON perp_transactions (account_id);
CREATE INDEX IF NOT EXISTS idx_perp_txn_position ON perp_transactions (account_id, position_id);
CREATE INDEX IF NOT EXISTS idx_perp_txn_type ON perp_transactions (account_id, txn_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_perp_txn_close_once
  ON perp_transactions (account_id, position_id)
  WHERE txn_type = 'close';

-- Open perp positions (authoritative for logged-in users; replaced on each sync).
CREATE TABLE IF NOT EXISTS perp_open_positions (
  position_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('long', 'short')),
  entry_price REAL NOT NULL,
  notional_usdc REAL NOT NULL,
  leverage REAL NOT NULL,
  margin_usdc REAL NOT NULL,
  opened_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_perp_open_account ON perp_open_positions (account_id);
