/**
 * Match server `plugins/swapApiPlugin.ts` computeSwapAmounts.
 * `rate` is SWAP_QUSD_USDC_RATE: **QUSD per 1 USDC** (divisor for QUSD → USDC).
 * USDC out = QUSD ÷ rate, rounded to 2 decimal places, then capped by max and treasury.
 * QUSD debited = USDC out × rate (8 dp), capped by `qusdIn` when rounding requires it.
 */

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
