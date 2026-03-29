/**
 * Puzzle vault (SQLite + encrypted solutions + QUEST funding) — environment contract.
 * Step 1: parse and validate configuration only. DB and backup logic use these in later steps.
 */

import path from "node:path"

export const PUZZLE_SOURCE_ENV = "env"
export const PUZZLE_SOURCE_SQLITE = "sqlite"

/** @returns {"env"|"sqlite"} */
export function parsePuzzleSource() {
  const raw = process.env.PUZZLE_SOURCE?.trim().toLowerCase()
  if (!raw || raw === "env") return PUZZLE_SOURCE_ENV
  if (raw === "sqlite") return PUZZLE_SOURCE_SQLITE
  throw new Error(`PUZZLE_SOURCE must be "env" or "sqlite"; got: ${JSON.stringify(process.env.PUZZLE_SOURCE)}`)
}

/**
 * Max rotated backup files to retain (newest first after sort). Default 7, clamped 1–50.
 * @returns {number}
 */
export function parseSqliteBackupKeep() {
  const n = Number(process.env.SQLITE_BACKUP_KEEP)
  if (!Number.isFinite(n)) return 7
  return Math.min(50, Math.max(1, Math.floor(n)))
}

/**
 * Directory for pre-mutation SQLite copies. Default: sibling folder `puzzle-vault-backups` next to the DB file.
 * @param {string} sqlitePath - resolved or raw SQLITE_PATH
 * @returns {string} absolute directory path, or "" if cannot derive
 */
export function resolveSqliteBackupDir(sqlitePath) {
  const explicit = process.env.SQLITE_BACKUP_DIR?.trim()
  if (explicit) return path.resolve(explicit)
  if (!sqlitePath?.trim()) return ""
  const abs = path.resolve(sqlitePath.trim())
  return path.join(path.dirname(abs), "puzzle-vault-backups")
}

/**
 * SQLite file + backup dirs only (no QUEST / operator key). Enough to open the DB and run `vault-init migrate`.
 * @returns {{
 *   sqlitePath: string,
 *   backupDir: string,
 *   backupKeep: number,
 *   hkdfSaltHex: string | null,
 * }}
 */
export function requireSqliteStorageEnv() {
  if (parsePuzzleSource() !== PUZZLE_SOURCE_SQLITE) {
    throw new Error("requireSqliteStorageEnv() only valid when PUZZLE_SOURCE=sqlite")
  }
  const sqlitePath = process.env.SQLITE_PATH?.trim()
  if (!sqlitePath) {
    throw new Error("SQLITE_PATH is required when PUZZLE_SOURCE=sqlite")
  }
  const salt = process.env.ENCRYPTION_HKDF_SALT_HEX?.trim() || null
  if (salt !== null) {
    if (!/^[0-9a-fA-F]+$/.test(salt) || salt.length < 16) {
      throw new Error("ENCRYPTION_HKDF_SALT_HEX must be hex, at least 16 hex chars (8 bytes), if set")
    }
  }
  return {
    sqlitePath: path.resolve(sqlitePath),
    backupDir: resolveSqliteBackupDir(sqlitePath),
    backupKeep: parseSqliteBackupKeep(),
    hkdfSaltHex: salt,
  }
}

/**
 * Full vault-related env when PUZZLE_SOURCE=sqlite (storage + QUEST funding inputs).
 * Call only after confirming parsePuzzleSource() === "sqlite".
 * @returns {{
 *   sqlitePath: string,
 *   backupDir: string,
 *   backupKeep: number,
 *   questOperatorSecretKey: string,
 *   questMint: string,
 *   questFundAmountRaw: string,
 *   hkdfSaltHex: string | null,
 * }}
 */
export function requireSqliteVaultEnv() {
  const base = requireSqliteStorageEnv()
  const questOperatorSecretKey = process.env.QUEST_OPERATOR_SECRET_KEY?.trim()
  if (!questOperatorSecretKey) {
    throw new Error("QUEST_OPERATOR_SECRET_KEY is required when PUZZLE_SOURCE=sqlite (Solana secret key; base58 or JSON byte array)")
  }
  const questMint = process.env.QUEST_MINT?.trim()
  if (!questMint) {
    throw new Error("QUEST_MINT is required when PUZZLE_SOURCE=sqlite (SPL mint address)")
  }
  const rawAmt = process.env.QUEST_FUND_AMOUNT_RAW?.trim()
  if (!rawAmt || !/^\d+$/.test(rawAmt) || rawAmt === "0") {
    throw new Error(
      "QUEST_FUND_AMOUNT_RAW is required when PUZZLE_SOURCE=sqlite (positive integer, smallest token units)"
    )
  }
  return {
    ...base,
    questOperatorSecretKey,
    questMint,
    questFundAmountRaw: rawAmt,
  }
}

/**
 * Safe summary for logs (no secrets).
 */
export function puzzleVaultEnvSummary() {
  try {
    const src = parsePuzzleSource()
    if (src === PUZZLE_SOURCE_ENV) {
      return { puzzle_source: PUZZLE_SOURCE_ENV, sqlite_backup_keep_default: parseSqliteBackupKeep() }
    }
    const s = requireSqliteStorageEnv()
    const partial = {
      puzzle_source: PUZZLE_SOURCE_SQLITE,
      sqlite_path: s.sqlitePath,
      backup_dir: s.backupDir,
      backup_keep: s.backupKeep,
      hkdf_salt_configured: Boolean(s.hkdfSaltHex),
    }
    try {
      const v = requireSqliteVaultEnv()
      return {
        ...partial,
        quest_mint: v.questMint,
        quest_fund_amount_raw: v.questFundAmountRaw,
        quest_operator_key_configured: true,
      }
    } catch (e) {
      return {
        ...partial,
        quest_operator_key_configured: false,
        quest_env_pending: String(e?.message || e),
      }
    }
  } catch (e) {
    return { puzzle_source: "error", error: String(e?.message || e) }
  }
}
