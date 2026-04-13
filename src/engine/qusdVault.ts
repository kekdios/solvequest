/** Demo vault: 1% interest per day on locked QUSD. */
import { parseQusdMultiplier } from "../lib/qusdMultiplier";

/** $1 USDC converts to this many QUSD (vault top-up/withdraw; from `QUSD_MULTIPLIER` in `.env`). */
export const QUSD_PER_USD = parseQusdMultiplier(
  (typeof process !== "undefined" ? process.env.QUSD_MULTIPLIER : undefined) ?? import.meta.env?.QUSD_MULTIPLIER,
);
/** QUSD granted as “free” at session start — excluded from externally sendable stablecoin. */
export const INITIAL_FREE_QUSD_GRANT = 10_000;
/** USDC/USDT required to repay the bonus before external Send is unlocked. */
export const BONUS_REPAYMENT_USDC = 100;
/** Locked QUSD cannot move to unlocked until this long after the last lock or unlock. */
export const LOCKED_QUSD_COOLDOWN_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * USDC/USDT that may be sent externally: ((unlocked − accumulated losses) − free grant) / 100.
 * Same 100 QUSD : 1 USD convention as elsewhere.
 */
export function computeExternalSendableStablecoin(qusdUnlocked: number, accumulatedLossesQusd: number): number {
  const raw = qusdUnlocked - accumulatedLossesQusd - INITIAL_FREE_QUSD_GRANT;
  return Math.max(0, raw / QUSD_PER_USD);
}
export const QUSD_DAILY_INTEREST_RATE = 0.01;
export const MINUTES_PER_DAY = 1440;
/** Portion of the daily rate applied each minute (simple schedule). */
export const QUSD_INTEREST_PER_MINUTE_FACTOR = QUSD_DAILY_INTEREST_RATE / MINUTES_PER_DAY;
