/**
 * Persists demo-mode app state to localStorage (no server, no registration).
 */
import { createAccount } from "../engine/insurance";
import { applyTierToAccount, DEFAULT_INSURANCE_TIER_ID } from "../engine/insuranceTiers";
import { INITIAL_COVERAGE_WARN_FLAGS } from "../engine/coverageWarnings";
import { DEFAULT_PERP_LEVERAGE, INITIAL_MARKS } from "../engine/perps";
import type { DemoAppState } from "./demoSessionTypes";

const STORAGE_KEY = "insured-demo-session-v1";
const SCHEMA_VERSION = 1;

type StoredEnvelope = {
  v: number;
  state: DemoAppState;
};

export function getDefaultDemoAppState(): DemoAppState {
  return {
    account: applyTierToAccount(createAccount("demo", 0), DEFAULT_INSURANCE_TIER_ID),
    insuranceTierId: DEFAULT_INSURANCE_TIER_ID,
    log: [],
    perpPositions: [],
    marks: { ...INITIAL_MARKS },
    coverageWarnFlags: INITIAL_COVERAGE_WARN_FLAGS,
    accumulatedLossesQusd: 0,
    qusd: { unlocked: 10_000, locked: 0 },
    bonusRepaidUsdc: 0,
    vaultActivityAt: null,
  };
}

export function loadDemoAppState(): DemoAppState | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredEnvelope;
    if (parsed.v !== SCHEMA_VERSION || !parsed.state || typeof parsed.state !== "object") {
      return null;
    }
    const s = parsed.state as DemoAppState;
    if (!s.account || !s.qusd || !Array.isArray(s.log)) return null;
    /** Leverage is fixed at 100×; legacy saves may differ — normalize exposure + multiplier. */
    if (Array.isArray(s.perpPositions) && s.perpPositions.length > 0) {
      s.perpPositions = s.perpPositions.map((p) => ({
        ...p,
        leverage: DEFAULT_PERP_LEVERAGE,
        notionalUsdc: p.marginUsdc * DEFAULT_PERP_LEVERAGE,
      }));
    }
    return s;
  } catch {
    return null;
  }
}

export function saveDemoAppState(state: DemoAppState): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const env: StoredEnvelope = { v: SCHEMA_VERSION, state };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(env));
  } catch {
    /* quota / private mode */
  }
}

export function clearDemoAppState(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.removeItem(STORAGE_KEY);
}
