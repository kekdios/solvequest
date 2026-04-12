/**
 * Persists simulated perp positions for logged-in users (browser localStorage).
 * Server SQLite does not store open perps — without this, refresh/deploy clears positions.
 */
import { DEFAULT_PERP_LEVERAGE } from "../engine/perps";
import type { PerpPosition } from "../engine/perps";

const KEY_PREFIX = "insured-user-perp-v1:";
const SCHEMA_VERSION = 1;

type Stored = {
  v: number;
  perpPositions: PerpPosition[];
};

function keyForEmail(email: string): string {
  return `${KEY_PREFIX}${email.trim().toLowerCase()}`;
}

export function loadUserPerpPositions(email: string | null | undefined): PerpPosition[] | null {
  if (!email || typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(keyForEmail(email));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (parsed.v !== SCHEMA_VERSION || !Array.isArray(parsed.perpPositions)) return null;
    if (parsed.perpPositions.length === 0) return [];
    return parsed.perpPositions.map((p) => ({
      ...p,
      leverage: DEFAULT_PERP_LEVERAGE,
      notionalUsdc: p.marginUsdc * DEFAULT_PERP_LEVERAGE,
    }));
  } catch {
    return null;
  }
}

export function saveUserPerpPositions(email: string | null | undefined, positions: PerpPosition[]): void {
  if (!email || typeof window === "undefined" || !window.localStorage) return;
  try {
    const env: Stored = { v: SCHEMA_VERSION, perpPositions: positions };
    window.localStorage.setItem(keyForEmail(email), JSON.stringify(env));
  } catch {
    /* quota */
  }
}
