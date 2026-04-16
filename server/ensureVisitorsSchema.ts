/**
 * Ensures `visitors` exists (new installs + older DBs opened before this table existed).
 */
import type Database from "better-sqlite3";

type SqliteDb = InstanceType<typeof Database>;

export function ensureVisitorsSchema(database: SqliteDb): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS visitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      ip TEXT NOT NULL,
      location TEXT NOT NULL,
      path TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_visitors_created ON visitors (created_at DESC);
  `);
}
