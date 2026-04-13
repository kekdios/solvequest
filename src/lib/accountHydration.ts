import { syncEquity } from "../engine/accountCore";
import type { Account } from "../engine/types";
import type { PersistedAccountRow } from "../db/persistedAccount";

/** Reducer slice from GET /api/account/me (SQLite row JSON). */
export function persistedRowToAppSlice(row: PersistedAccountRow) {
  const userId = row.email ?? row.id;
  return {
    account: accountRowToAccount(row, userId),
    qusd: {
      unlocked: Number(row.qusd_unlocked),
      locked: Number(row.qusd_locked),
    },
    accumulatedLossesQusd: Number(row.accumulated_losses_qusd),
  };
}

/**
 * Maps a SQLite `accounts` row (from GET /api/account/me) into engine `Account` + app fields.
 * `coverage_limit_qusd` is authoritative (tier + cap extensions).
 */
export function accountRowToAccount(row: PersistedAccountRow, userId: string): Account {
  const balance = Number(row.usdc_balance);
  return syncEquity({
    userId,
    balance,
    equity: balance,
    unrealizedPnL: 0,
    plan: {
      coverageLimit: Number(row.coverage_limit_qusd),
    },
    premiumAccrued: Number(row.premium_accrued_usdc),
    coveredLosses: Number(row.covered_losses_qusd),
    coverageUsed: Number(row.coverage_used_qusd),
  });
}
