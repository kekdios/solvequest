export type LossCapPlan = {
  /** Max QUSD of losses absorbed before the cap is hit (tier base + optional extensions). */
  coverageLimit: number;
};

export type Account = {
  userId: string;
  balance: number;
  equity: number;
  unrealizedPnL: number;
  plan: LossCapPlan;
  premiumAccrued: number;
  /** Cumulative QUSD absorbed toward losses (stats). */
  coveredLosses: number;
  /** QUSD of loss capacity consumed toward coverageLimit. */
  coverageUsed: number;
};

export type LossBreakdown = {
  loss: number;
  /** Portion absorbed under the loss cap. */
  capAbsorbed: number;
  userPays: number;
};

export type WithdrawResult =
  | { ok: true }
  | { ok: false; reason: string; topUpNeeded?: number };
