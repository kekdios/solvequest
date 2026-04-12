import type { Account } from "./types";
import { computeUnrealizedPnl, type PerpPosition, type PerpSymbol } from "./perps";
import { syncEquity } from "./insurance";
import { getInsuranceTier, type InsuranceTierId } from "./insuranceTiers";

export type QusdVault = { unlocked: number; locked: number };

/**
 * Close all positions at current marks (forced liquidation path).
 * Margin and PnL settle in QUSD against unlocked QUSD.
 */
export function forceCloseAllPerps(args: {
  account: Account;
  qusd: QusdVault;
  positions: PerpPosition[];
  marks: Record<PerpSymbol, number>;
  insuranceTierId: InsuranceTierId;
}): { account: Account; qusd: QusdVault; lossesQusd: number } {
  let acc = args.account;
  let uq = args.qusd.unlocked;
  const tier = getInsuranceTier(args.insuranceTierId);
  let lossesQusd = 0;

  for (const pos of args.positions) {
    const mark = args.marks[pos.symbol];
    const upl = computeUnrealizedPnl(pos, mark);
    const margin = pos.marginUsdc;

    if (upl >= 0) {
      const poolContribution = upl * tier.winningsPct;
      uq += margin + upl - poolContribution;
      acc = syncEquity({
        ...acc,
        premiumAccrued: acc.premiumAccrued + poolContribution,
      });
    } else {
      const loss = Math.abs(upl);
      lossesQusd += loss;
      const remaining = Math.max(0, acc.plan.coverageLimit - acc.coverageUsed);
      const poolCovered = Math.min(loss, remaining);
      const userPays = loss - poolCovered;
      acc = syncEquity({
        ...acc,
        coverageUsed: acc.coverageUsed + poolCovered,
        coveredLosses: acc.coveredLosses + poolCovered,
      });
      uq += margin - userPays;
      if (uq < 0) uq = 0;
    }
  }

  return { account: acc, qusd: { ...args.qusd, unlocked: uq }, lossesQusd };
}
