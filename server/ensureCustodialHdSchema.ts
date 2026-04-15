/**
 * Adds `custodial_derivation_index` + unique partial index when missing (older DBs).
 * Idempotent. Called on every SQLite open in the API and deposit worker.
 */
import type Database from "better-sqlite3";

type SqliteDb = InstanceType<typeof Database>;

export function ensureCustodialHdSchema(database: SqliteDb): void {
  const hasAccounts = database
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'accounts' LIMIT 1`)
    .get() as { ok: number } | undefined;
  if (!hasAccounts) return;

  const cols = database.prepare(`PRAGMA table_info(accounts)`).all() as { name: string }[];
  const has = cols.some((c) => c.name === "custodial_derivation_index");
  if (!has) {
    database.exec(`ALTER TABLE accounts ADD COLUMN custodial_derivation_index INTEGER;`);
    console.log("[sqlite] Added column accounts.custodial_derivation_index");
  }
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_custodial_derivation_unique
      ON accounts (custodial_derivation_index)
      WHERE custodial_derivation_index IS NOT NULL;
  `);

  const hasVerifiedAt = cols.some((c) => c.name === "sol_receive_verified_at");
  if (!hasVerifiedAt) {
    database.exec(`ALTER TABLE accounts ADD COLUMN sol_receive_verified_at INTEGER;`);
    console.log("[sqlite] Added column accounts.sol_receive_verified_at");
  }

  /** Legacy server-assigned HD (or encrypted) deposit addresses count as verified — no duplicate QUSD bonus. */
  try {
    database.exec(`
      UPDATE accounts SET sol_receive_verified_at = COALESCE(updated_at, created_at)
      WHERE sol_receive_verified_at IS NULL
        AND TRIM(COALESCE(sol_receive_address, '')) != ''
        AND (
          custodial_derivation_index IS NOT NULL
          OR (custodial_seckey_enc IS NOT NULL AND TRIM(custodial_seckey_enc) != '')
        );
    `);
  } catch {
    /* older DBs without custodial columns */
  }
}
