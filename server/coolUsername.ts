/**
 * Multi-word identity: adjective-animal-color-number (crypto.randomBytes indexing).
 */
import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { COOL_ADJECTIVES, COOL_ANIMALS, COOL_COLORS } from "./coolUsernameWordlists";

type SqliteDb = InstanceType<typeof Database>;

export function generateCoolUsername(): string {
  const buf = crypto.randomBytes(8);
  const adj = COOL_ADJECTIVES[buf.readUInt16BE(0) % COOL_ADJECTIVES.length];
  const animal = COOL_ANIMALS[buf.readUInt16BE(2) % COOL_ANIMALS.length];
  const color = COOL_COLORS[buf.readUInt16BE(4) % COOL_COLORS.length];
  const num = buf.readUInt16BE(6) % 1000;
  return `${adj}-${animal}-${color}-${num}`;
}

/**
 * Sets `accounts.username` once (when NULL). Retries on UNIQUE collision (extremely rare).
 * Returns the username now stored for this account, or null if the account row is missing.
 */
export function assignCoolUsernameIfMissing(database: SqliteDb, accountId: string): string | null {
  const existing = database
    .prepare(`SELECT username FROM accounts WHERE id = ?`)
    .get(accountId) as { username: string | null } | undefined;
  if (!existing) return null;
  const trimmed = existing.username?.trim();
  if (trimmed) return trimmed;

  const now = Date.now();
  for (let attempt = 0; attempt < 24; attempt++) {
    const candidate = generateCoolUsername();
    try {
      const r = database
        .prepare(
          `UPDATE accounts SET username = ?, updated_at = ? WHERE id = ? AND (username IS NULL OR TRIM(username) = '')`,
        )
        .run(candidate, now, accountId);
      if (r.changes > 0) return candidate;
      const again = database
        .prepare(`SELECT username FROM accounts WHERE id = ?`)
        .get(accountId) as { username: string | null } | undefined;
      const t = again?.username?.trim();
      if (t) return t;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE") || msg.includes("unique")) continue;
      throw e;
    }
  }
  return null;
}
