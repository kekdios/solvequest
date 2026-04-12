export type InsurancePlan = {
  /** Maximum QUSD of losses the pool can absorb before the cap is hit (tier base + optional extensions). */
  coverageLimit: number;
};

export type Account = {
  userId: string;
  balance: number;
  equity: number;
  unrealizedPnL: number;
  plan: InsurancePlan;
  premiumAccrued: number;
  /** Cumulative QUSD paid by the pool toward losses (for stats). */
  coveredLosses: number;
  /** QUSD of loss capacity consumed toward coverageLimit. */
  coverageUsed: number;
};

export type LossBreakdown = {
  loss: number;
  /** Amount the pool covered from this loss (counts toward coverage cap). */
  poolCovered: number;
  /** Remaining loss charged to the user’s balance. */
  userPays: number;
};

export type WithdrawResult =
  | { ok: true }
  | { ok: false; reason: string; topUpNeeded?: number };
