import type { Account, InsurancePlan, LossBreakdown, WithdrawResult } from "./types";

export const DEFAULT_PLAN: InsurancePlan = {
  coverageLimit: 50_000,
};

export function syncEquity(account: Account): Account {
  return { ...account, equity: account.balance + account.unrealizedPnL };
}

export function createAccount(userId: string, initialDeposit: number): Account {
  return syncEquity({
    userId,
    balance: initialDeposit,
    equity: initialDeposit,
    unrealizedPnL: 0,
    plan: { ...DEFAULT_PLAN },
    premiumAccrued: 0,
    coveredLosses: 0,
    coverageUsed: 0,
  });
}

/** Legacy equity-based drip — disabled when premiumRate is 0. */
export function chargePremium(account: Account): Account {
  const base = account.equity;
  const premium = base * 0;
  const next = {
    ...account,
    balance: account.balance - premium,
    premiumAccrued: account.premiumAccrued + premium,
  };
  return syncEquity(next);
}

/**
 * Pool covers losses up to remaining coverage capacity; anything beyond is paid from balance.
 * No separate deductible — the cap IS the max insured loss absorption.
 */
export function handleLoss(account: Account, loss: number): { account: Account; breakdown: LossBreakdown } {
  if (loss <= 0) {
    return {
      account,
      breakdown: { loss: 0, poolCovered: 0, userPays: 0 },
    };
  }

  const limit = account.plan.coverageLimit;
  const remaining = Math.max(0, limit - account.coverageUsed);
  const poolCovered = Math.min(loss, remaining);
  const userPays = loss - poolCovered;

  return {
    account: syncEquity({
      ...account,
      coverageUsed: account.coverageUsed + poolCovered,
      coveredLosses: account.coveredLosses + poolCovered,
      balance: account.balance - userPays,
      unrealizedPnL: account.unrealizedPnL - loss,
    }),
    breakdown: {
      loss,
      poolCovered,
      userPays,
    },
  };
}

/** Pay 1 USDC to extend max covered losses by 200 QUSD. */
export const COVERAGE_PREMIUM_USDC = 1;
export const COVERAGE_PREMIUM_QUSD = 200;

export function purchaseCoverageExtension(account: Account): { account: Account; ok: boolean } {
  if (account.balance < COVERAGE_PREMIUM_USDC) {
    return { account, ok: false };
  }
  return {
    account: syncEquity({
      ...account,
      balance: account.balance - COVERAGE_PREMIUM_USDC,
      premiumAccrued: account.premiumAccrued + COVERAGE_PREMIUM_USDC,
      plan: {
        ...account.plan,
        coverageLimit: account.plan.coverageLimit + COVERAGE_PREMIUM_QUSD,
      },
    }),
    ok: true,
  };
}

export function canWithdraw(_account: Account): WithdrawResult {
  return { ok: true };
}

export function requireTopUp(_account: Account): number {
  return 0;
}

export type AdjustPlanConfig = {
  coverageUseThreshold: number;
  lowBalanceThreshold: number;
};

export function adjustPlan(account: Account, _config: AdjustPlanConfig): Account {
  return account;
}
