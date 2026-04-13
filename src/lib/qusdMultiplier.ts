/** Default when env is missing or invalid. */
export const DEFAULT_QUSD_MULTIPLIER = 100;

/**
 * Parses USDC→QUSD rate (QUSD per $1 USDC), e.g. 100 ⇒ $1 USDC = 100 QUSD.
 * Used by client (Vite `import.meta.env.QUSD_MULTIPLIER`) and server (`process.env.QUSD_MULTIPLIER`).
 */
export function parseQusdMultiplier(raw: string | undefined | null): number {
  if (raw == null || String(raw).trim() === "") return DEFAULT_QUSD_MULTIPLIER;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_QUSD_MULTIPLIER;
}
