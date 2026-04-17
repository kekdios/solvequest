/** Match server `plugins/swapApiPlugin.ts` computeSwapAmounts. */

export function computeSwapAmounts(
  qusdIn: number,
  rate: number,
  maxUsdc: number,
  treasuryUsdc: number,
): { qusdDebit: number; usdcOut: number } {
  if (!(qusdIn > 0) || !(rate > 0)) return { qusdDebit: 0, usdcOut: 0 };
  const rawUsdc = qusdIn * rate;
  let usdcOut = Math.min(rawUsdc, maxUsdc, treasuryUsdc);
  usdcOut = Math.floor(usdcOut * 1e6) / 1e6;
  if (usdcOut <= 1e-9) return { qusdDebit: 0, usdcOut: 0 };
  let qusdDebit = usdcOut / rate;
  qusdDebit = Math.round(qusdDebit * 1e8) / 1e8;
  if (qusdDebit > qusdIn + 1e-9) qusdDebit = qusdIn;
  return { qusdDebit, usdcOut };
}
