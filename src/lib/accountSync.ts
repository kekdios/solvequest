import type { DemoAppState } from "./demoSessionTypes";
import type { PerpPosition } from "../engine/perps";

/** Body for PUT /api/account/state (matches server zod schema). */
export type AccountStatePutBody = {
  usdc_balance: number;
  coverage_limit_qusd: number;
  premium_accrued_usdc: number;
  covered_losses_qusd: number;
  coverage_used_qusd: number;
  /** Stored pool: display unlocked + margin in open positions. */
  qusd_unlocked: number;
  qusd_locked: number;
  accumulated_losses_qusd: number;
  bonus_repaid_usdc: number;
  vault_activity_at: number | null;
  open_perp_positions: PerpPosition[];
};

/**
 * Maps client reducer state → DB row + open positions.
 * `qusd_unlocked` in DB is pre-margin pool (same convention as hydrate).
 */
export function buildAccountStatePutBody(state: DemoAppState): AccountStatePutBody {
  const marginInPos = state.perpPositions.reduce((s, p) => s + p.marginUsdc, 0);
  return {
    usdc_balance: state.account.balance,
    coverage_limit_qusd: state.account.plan.coverageLimit,
    premium_accrued_usdc: state.account.premiumAccrued,
    covered_losses_qusd: state.account.coveredLosses,
    coverage_used_qusd: state.account.coverageUsed,
    qusd_unlocked: state.qusd.unlocked + marginInPos,
    qusd_locked: state.qusd.locked,
    accumulated_losses_qusd: state.accumulatedLossesQusd,
    bonus_repaid_usdc: state.bonusRepaidUsdc,
    vault_activity_at: state.vaultActivityAt,
    open_perp_positions: state.perpPositions,
  };
}

export async function putAccountState(body: AccountStatePutBody): Promise<boolean> {
  try {
    const r = await fetch("/api/account/state", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.ok;
  } catch {
    return false;
  }
}
