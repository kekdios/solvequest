-- Open perps + bonus/vault columns. Apply: sqlite3 path/to/db < db/migrations/005_account_state_and_open_perps.sql

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
