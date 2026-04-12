/**
 * Serializable app state for anonymous demo mode (browser-only persistence).
 * Keep in sync with the root reducer in `App.tsx`.
 */
import type { Account } from "../engine/types";
import type { CoverageWarnFlags } from "../engine/coverageWarnings";
import type { InsuranceTierId } from "../engine/insuranceTiers";
import type { PerpPosition, PerpSymbol } from "../engine/perps";

export type DemoLogEntry = {
  id: string;
  t: number;
  kind: "info" | "loss" | "premium" | "block" | "coverage";
  message: string;
};

export type DemoAppState = {
  account: Account;
  insuranceTierId: InsuranceTierId;
  log: DemoLogEntry[];
  perpPositions: PerpPosition[];
  marks: Record<PerpSymbol, number>;
  coverageWarnFlags: CoverageWarnFlags;
  accumulatedLossesQusd: number;
  qusd: { unlocked: number; locked: number };
  bonusRepaidUsdc: number;
  vaultActivityAt: number | null;
};
