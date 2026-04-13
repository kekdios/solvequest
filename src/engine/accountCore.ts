import type { Account, LossBreakdown, LossCapPlan, WithdrawResult } from "./types";

export const DEFAULT_PLAN: LossCapPlan = {
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

/** Legacy equity-based drip — disabled when premium rate is 0. */
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
 * Apply a loss: cap absorbs up to remaining capacity; remainder hits balance.
 */
export function applyLoss(account: Account, loss: number): { account: Account; breakdown: LossBreakdown } {
  if (loss <= 0) {
    return {
      account,
      breakdown: { loss: 0, capAbsorbed: 0, userPays: 0 },
    };
  }

  const limit = account.plan.coverageLimit;
  const remaining = Math.max(0, limit - account.coverageUsed);
  const capAbsorbed = Math.min(loss, remaining);
  const userPays = loss - capAbsorbed;

  return {
    account: syncEquity({
      ...account,
      coverageUsed: account.coverageUsed + capAbsorbed,
      coveredLosses: account.coveredLosses + capAbsorbed,
      balance: account.balance - userPays,
      unrealizedPnL: account.unrealizedPnL - loss,
    }),
    breakdown: {
      loss,
      capAbsorbed,
      userPays,
    },
  };
}

/** Pay 1 USDC to extend max loss cap by 200 QUSD. */
export const CAP_EXTENSION_FEE_USDC = 1;
export const CAP_EXTENSION_QUSD = 200;

export function purchaseCapExtension(account: Account): { account: Account; ok: boolean } {
  if (account.balance < CAP_EXTENSION_FEE_USDC) {
    return { account, ok: false };
  }
  return {
    account: syncEquity({
      ...account,
      balance: account.balance - CAP_EXTENSION_FEE_USDC,
      premiumAccrued: account.premiumAccrued + CAP_EXTENSION_FEE_USDC,
      plan: {
        ...account.plan,
        coverageLimit: account.plan.coverageLimit + CAP_EXTENSION_QUSD,
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
