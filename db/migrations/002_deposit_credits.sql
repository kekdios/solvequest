-- On-chain deposit credits (mirror of browser `insured-deposit-ledger-v1` for server workers / reconciliation).
-- Apply with: sqlite3 data/insured.db < db/migrations/002_deposit_credits.sql

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
