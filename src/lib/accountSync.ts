import type { DemoAppState, PerpCloseSyncEvent } from "./demoSessionTypes";
import type { PerpPosition } from "../engine/perps";

/** Body for PUT /api/account/state (matches server zod schema). */
export type AccountStatePutBody = {
  sync_version: number;
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
  /** Append-only closes to persist in `perp_transactions` (client removes only ACK'd ids after each successful PUT). */
  perp_close_events: PerpCloseSyncEvent[];
};

/**
 * Maps client reducer state → API body. `qusd_unlocked` is **display** unlocked (ledger convention on server).
 */
export function buildAccountStatePutBody(state: DemoAppState, syncVersion: number): AccountStatePutBody {
  return {
    sync_version: syncVersion,
    usdc_balance: state.account.balance,
    coverage_limit_qusd: state.account.plan.coverageLimit,
    premium_accrued_usdc: state.account.premiumAccrued,
    covered_losses_qusd: state.account.coveredLosses,
    coverage_used_qusd: state.account.coverageUsed,
    qusd_unlocked: state.qusd.unlocked,
    qusd_locked: state.qusd.locked,
    accumulated_losses_qusd: state.accumulatedLossesQusd,
    bonus_repaid_usdc: state.bonusRepaidUsdc,
    vault_activity_at: state.vaultActivityAt,
    open_perp_positions: state.perpPositions,
    perp_close_events: state.pendingPerpCloses,
  };
}

export type PutAccountStateResult =
  | { ok: true; sync_version: number }
  | { ok: false; conflict: true; sync_version: number }
  | { ok: false };

export async function putAccountState(body: AccountStatePutBody): Promise<PutAccountStateResult> {
  try {
    const r = await fetch("/api/account/state", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.status === 409) {
      const j = (await r.json()) as { sync_version?: number };
      return { ok: false, conflict: true, sync_version: Number(j.sync_version ?? 0) };
    }
    if (!r.ok) return { ok: false };
    const j = (await r.json()) as { sync_version?: number };
    return { ok: true, sync_version: Number(j.sync_version ?? 0) };
  } catch {
    return { ok: false };
  }
}
