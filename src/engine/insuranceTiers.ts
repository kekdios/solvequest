import type { Account } from "./types";

/** Three Smart Pool Insurance tiers — win skim to pool + max QUSD losses covered by the pool. */
export type InsuranceTierId = 1 | 2 | 3;

export type InsuranceTier = {
  id: InsuranceTierId;
  /** Skim from realized winning closes (fraction of profit). */
  winningsPct: number;
  /** Maximum QUSD of losses the pool can absorb (coverage cap). */
  maxLossCoveredQusd: number;
};

export const INSURANCE_TIERS: InsuranceTier[] = [
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

export function getInsuranceTier(id: InsuranceTierId): InsuranceTier {
  return INSURANCE_TIERS.find((t) => t.id === id)!;
}

export function applyTierToAccount(account: Account, tierId: InsuranceTierId): Account {
  const t = getInsuranceTier(tierId);
  return {
    ...account,
    plan: {
      coverageLimit: t.maxLossCoveredQusd,
    },
    coverageUsed: 0,
  };
}

export const DEFAULT_INSURANCE_TIER_ID: InsuranceTierId = 3;
