export type CoverageWarnFlags = { w10: boolean; w5: boolean; w1: boolean };

export const INITIAL_COVERAGE_WARN_FLAGS: CoverageWarnFlags = { w10: false, w5: false, w1: false };

/** Emit messages when remaining cover fraction crosses 10%, 5%, and 1% thresholds (first time each). */
export function nextCoverageWarnings(
  used: number,
  limit: number,
  prev: CoverageWarnFlags,
): { flags: CoverageWarnFlags; messages: string[] } {
  if (limit <= 0) return { flags: prev, messages: [] };
  const rem = (limit - used) / limit;
  const messages: string[] = [];
  const flags = { ...prev };
  if (rem <= 0.1 && !prev.w10) {
    messages.push("Coverage warning: 10% of max insured loss capacity remaining.");
    flags.w10 = true;
  }
  if (rem <= 0.05 && !prev.w5) {
    messages.push("Coverage warning: 5% of max insured loss capacity remaining.");
    flags.w5 = true;
  }
  if (rem <= 0.01 && !prev.w1) {
    messages.push("Coverage warning: 1% of max insured loss capacity remaining.");
    flags.w1 = true;
  }
  return { flags, messages };
}
