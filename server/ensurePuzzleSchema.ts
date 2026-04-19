import type Database from "better-sqlite3";

type SqliteDb = InstanceType<typeof Database>;

/** Idempotent: BIP39-order puzzle sessions for Agent Activation / QUSD drip. */
export function ensurePuzzleSchema(database: SqliteDb): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS puzzle_sessions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      words_json TEXT NOT NULL,
      solution_json TEXT NOT NULL,
      solved_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_puzzle_sessions_account ON puzzle_sessions (account_id);
    CREATE INDEX IF NOT EXISTS idx_puzzle_sessions_expires ON puzzle_sessions (expires_at);
  `);
}
