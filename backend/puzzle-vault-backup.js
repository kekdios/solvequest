/**
 * File-level backup for the puzzle vault SQLite DB before mutations.
 * Never creates an empty DB over an existing file — callers open with CREATE IF NOT EXISTS only.
 */

import fs from "node:fs"
import path from "node:path"

/**
 * @param {string} sqlitePath - absolute path to live .db file
 * @param {{ backupDir: string, keep: number }} opts
 * @returns {{ skipped: boolean, reason?: string, copiedTo?: string }}
 */
export function backupSqliteBeforeChange(sqlitePath, opts) {
  const abs = path.resolve(sqlitePath)
  const { backupDir, keep } = opts
  if (!backupDir?.trim()) {
    return { skipped: true, reason: "no_backup_dir" }
  }
  const dir = path.resolve(backupDir)
  if (!fs.existsSync(abs)) {
    return { skipped: true, reason: "db_not_found_yet" }
  }
  const st = fs.statSync(abs)
  if (!st.isFile() || st.size === 0) {
    return { skipped: true, reason: "db_missing_or_empty" }
  }

  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const base = path.basename(abs, path.extname(abs)) || "vault"
  const destName = `${base}-${stamp}.db`
  const dest = path.join(dir, destName)
  fs.copyFileSync(abs, dest)
  pruneOldBackups(dir, base, keep)
  return { skipped: false, copiedTo: dest }
}

/**
 * Remove oldest backup files for this DB basename beyond `keep` newest.
 * Matches files named `{base}-*.db` in `backupDir`.
 * @param {string} backupDir
 * @param {string} base - filename without .db
 * @param {number} keep
 */
export function pruneOldBackups(backupDir, base, keep) {
  const k = Math.max(1, Math.min(50, Math.floor(keep)))
  if (!fs.existsSync(backupDir)) return
  const prefix = `${base}-`
  const suffix = ".db"
  const entries = fs.readdirSync(backupDir, { withFileTypes: true })
  const files = []
  for (const e of entries) {
    if (!e.isFile()) continue
    const n = e.name
    if (!n.startsWith(prefix) || !n.endsWith(suffix)) continue
    const full = path.join(backupDir, n)
    try {
      const st = fs.statSync(full)
      files.push({ full, mtimeMs: st.mtimeMs })
    } catch {
      /* ignore */
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const toRemove = files.slice(k)
  for (const { full } of toRemove) {
    try {
      fs.unlinkSync(full)
    } catch {
      /* ignore */
    }
  }
}
