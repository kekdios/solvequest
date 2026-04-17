/**
 * Match server `plugins/swapApiPlugin.ts` computeSwapAmounts.
 * `rate` is SWAP_QUSD_USDC_RATE: **QUSD per 1 USDC** (divisor for QUSD → USDC).
 *
 * **Gross vs effective QUSD:** The user enters a *gross* QUSD amount (must be > SWAP_ABOVE_AMOUNT).
 * Only **(gross capped to balance − SWAP_ABOVE_AMOUNT)** is converted — the first `swapAbove` QUSD
 * of that gross does not become USDC. `computeSwapAmounts` is always called with this **effective** QUSD.
 *
 * USDC out = effective QUSD ÷ rate, rounded to 2 decimal places, then capped by max and treasury.
 * QUSD debited = USDC out × rate (8 dp), capped by effective when rounding requires it.
 */

/** QUSD that actually converts = min(gross, balance) − swapAbove (floored at 0). */
export function effectiveQusdForUsdcSwap(grossQusdIn: number, swapAbove: number, balanceCap: number): number {
  if (!Number.isFinite(grossQusdIn) || !Number.isFinite(swapAbove) || !Number.isFinite(balanceCap)) return 0;
  const gross = Math.min(Math.max(0, grossQusdIn), Math.max(0, balanceCap));
  return Math.max(0, gross - swapAbove);
}

export function computeSwapAmounts(
  qusdIn: number,
  rate: number,
  maxUsdc: number,
  treasuryUsdc: number,
): { qusdDebit: number; usdcOut: number } {
  if (!(qusdIn > 0) || !(rate > 0)) return { qusdDebit: 0, usdcOut: 0 };
  const uncappedRounded = Math.round((qusdIn / rate) * 100) / 100;
  let usdcOut = Math.min(uncappedRounded, maxUsdc, treasuryUsdc);
  usdcOut = Math.round(usdcOut * 100) / 100;
  if (usdcOut <= 1e-9) return { qusdDebit: 0, usdcOut: 0 };
  let qusdDebit = usdcOut * rate;
  qusdDebit = Math.round(qusdDebit * 1e8) / 1e8;
  if (qusdDebit > qusdIn + 1e-9) qusdDebit = qusdIn;
  return { qusdDebit, usdcOut };
}
