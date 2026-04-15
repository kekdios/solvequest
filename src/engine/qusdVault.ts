import { parseQusdMultiplier } from "../lib/qusdMultiplier";

/** $1 USDC converts to this many QUSD (from `QUSD_MULTIPLIER` in `.env`). */
export const QUSD_PER_USD = parseQusdMultiplier(
  (typeof process !== "undefined" ? process.env.QUSD_MULTIPLIER : undefined) ?? import.meta.env?.QUSD_MULTIPLIER,
);
/** QUSD granted as “free” at session start — excluded from externally sendable stablecoin. */
export const INITIAL_FREE_QUSD_GRANT = 10_000;
/** USDC/USDT required to repay the bonus before external Send is unlocked. */
export const BONUS_REPAYMENT_USDC = 100;

/**
 * USDC/USDT that may be sent externally: ((unlocked − accumulated losses) − free grant) / 100.
 * Same 100 QUSD : 1 USD convention as elsewhere.
 */
export function computeExternalSendableStablecoin(qusdUnlocked: number, accumulatedLossesQusd: number): number {
  const raw = qusdUnlocked - accumulatedLossesQusd - INITIAL_FREE_QUSD_GRANT;
  return Math.max(0, raw / QUSD_PER_USD);
}
