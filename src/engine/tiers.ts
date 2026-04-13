import type { Account } from "./types";

/** Three account tiers — win skim to protocol + max QUSD loss cap. */
export type TierId = 1 | 2 | 3;

export type TierDef = {
  id: TierId;
  /** Skim from realized winning closes (fraction of profit). */
  winningsPct: number;
  /** Maximum QUSD losses absorbed under the cap. */
  maxLossCoveredQusd: number;
};

export const TIER_DEFS: TierDef[] = [
  {
    id: 1,
    winningsPct: 0.01,
    maxLossCoveredQusd: 10_000,
  },
  {
    id: 2,
    winningsPct: 0.05,
    maxLossCoveredQusd: 25_000,
  },
  {
    id: 3,
    winningsPct: 0.1,
    maxLossCoveredQusd: 50_000,
  },
];

export function getTier(id: TierId): TierDef {
  return TIER_DEFS.find((t) => t.id === id)!;
}

export function applyTierToAccount(account: Account, tierId: TierId): Account {
  const t = getTier(tierId);
  return {
    ...account,
    plan: {
      coverageLimit: t.maxLossCoveredQusd,
    },
    coverageUsed: 0,
  };
}

export const DEFAULT_TIER_ID: TierId = 3;
