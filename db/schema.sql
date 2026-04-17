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
  /* Legacy — unused for new accounts; user deposit addresses are user-verified only. */
  custodial_seckey_enc TEXT,
  custodial_derivation_index INTEGER,
  sync_version INTEGER NOT NULL DEFAULT 0,
  /** Public leaderboard handle: adjective-animal-color-number; set when email is verified. */
  username TEXT
);

CREATE INDEX IF NOT EXISTS idx_accounts_updated ON accounts (updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email ON accounts (email) WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_username_unique
  ON accounts (username)
  WHERE username IS NOT NULL AND TRIM(username) != '';

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

-- Single-row watermark for USDC deposits to the shared treasury USDC ATA (see server/treasuryUsdcDepositScan.ts).
CREATE TABLE IF NOT EXISTS deposit_treasury_scan (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  watermark_signature TEXT
);
INSERT OR IGNORE INTO deposit_treasury_scan (id, watermark_signature) VALUES (1, NULL);

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

/** Anonymous and signed-in SPA views: IP, resolved location label, logical app path, timestamp. */
CREATE TABLE IF NOT EXISTS visitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  ip TEXT NOT NULL,
  location TEXT NOT NULL,
  path TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_visitors_created ON visitors (created_at DESC);

/** Accounts that have already received the daily QUSD prize — at most one win per account (lifetime). */
CREATE TABLE IF NOT EXISTS daily_prize_winners (
  account_id TEXT PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  won_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_daily_prize_winners_won_at ON daily_prize_winners (won_at DESC);
