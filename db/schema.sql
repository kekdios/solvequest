-- Solve Quest — SQLite schema (QUSD balances from qusd_ledger sums).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  email TEXT,
  usdc_balance REAL NOT NULL,
  coverage_limit_qusd REAL NOT NULL,
  premium_accrued_usdc REAL NOT NULL DEFAULT 0,
  covered_losses_qusd REAL NOT NULL DEFAULT 0,
  coverage_used_qusd REAL NOT NULL DEFAULT 0,
  tier_id INTEGER NOT NULL CHECK (tier_id IN (1, 2, 3)),
  accumulated_losses_qusd REAL NOT NULL DEFAULT 0,
  bonus_repaid_usdc REAL NOT NULL DEFAULT 0,
  vault_activity_at INTEGER,
  qusd_vault_interest_at INTEGER,
  sol_receive_address TEXT,
  /** Set when the user completed on-chain verification (address locked after this). */
  sol_receive_verified_at INTEGER,
  custodial_seckey_enc TEXT,
  /** HD path index m/44'/501'/<n>'/0'; null for legacy encrypted-only or pre-HD rows. */
  custodial_derivation_index INTEGER,
  sync_version INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_accounts_updated ON accounts (updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email ON accounts (email) WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_sol_receive_unique
  ON accounts (sol_receive_address)
  WHERE sol_receive_address IS NOT NULL AND TRIM(sol_receive_address) != '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_custodial_derivation_unique
  ON accounts (custodial_derivation_index)
  WHERE custodial_derivation_index IS NOT NULL;

/** Append-only QUSD movements; display unlocked = SUM(unlocked_delta), locked = SUM(locked_delta). */
CREATE TABLE IF NOT EXISTS qusd_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  entry_type TEXT NOT NULL,
  unlocked_delta REAL NOT NULL,
  locked_delta REAL NOT NULL,
  ref_type TEXT,
  ref_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_qusd_ledger_account ON qusd_ledger (account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_qusd_ledger_idem
  ON qusd_ledger (account_id, ref_type, ref_id)
  WHERE ref_type IS NOT NULL AND ref_id IS NOT NULL;

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

CREATE TABLE IF NOT EXISTS perp_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  position_id TEXT NOT NULL,
  txn_type TEXT NOT NULL CHECK (txn_type IN ('open', 'close')),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('long', 'short')),
  entry_price REAL,
  notional_usdc REAL,
  leverage REAL,
  margin_usdc REAL,
  opened_at INTEGER,
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
