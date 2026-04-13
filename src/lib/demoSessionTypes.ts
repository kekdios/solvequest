/**
 * Serializable app state for anonymous demo mode (browser-only persistence).
 * Keep in sync with the root reducer in `App.tsx`.
 */
import type { Account } from "../engine/types";
import type { PerpPosition, PerpSymbol } from "../engine/perps";

export type SessionWarnFlags = { w10: boolean; w5: boolean; w1: boolean };

export const INITIAL_SESSION_WARN_FLAGS: SessionWarnFlags = { w10: false, w5: false, w1: false };

export type DemoLogEntry = {
  id: string;
  t: number;
  kind: "info" | "loss" | "premium" | "block" | "alert";
  message: string;
};

export type DemoAppState = {
  account: Account;
  log: DemoLogEntry[];
  perpPositions: PerpPosition[];
  marks: Record<PerpSymbol, number>;
  sessionWarnFlags: SessionWarnFlags;
  accumulatedLossesQusd: number;
  qusd: { unlocked: number; locked: number };
  bonusRepaidUsdc: number;
  vaultActivityAt: number | null;
};
