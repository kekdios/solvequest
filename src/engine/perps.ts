export type PerpSymbol =
  | "BTC-PERP"
  | "ETH-PERP"
  | "SOL-PERP"
  | "GOLD-PERP"
  | "SILVER-PERP"
  | "OIL-PERP";

export type PerpPosition = {
  id: string;
  symbol: PerpSymbol;
  side: "long" | "short";
  entryPrice: number;
  /** Notional exposure = `marginUsdc * leverage` (QUSD units). */
  notionalUsdc: number;
  /** Leverage multiplier L (e.g. 100). */
  leverage: number;
  /** Margin tokens bet (QUSD locked). */
  marginUsdc: number;
  openedAt: number;
};

/** Default leverage for new positions (100× ⇒ a 1% adverse index move wipes margin on a long). */
export const DEFAULT_PERP_LEVERAGE = 100;

/** Crypto majors — Hyperliquid `allMids` coin keys (BTC, ETH, SOL). */
export const MAIN_PERP_SYMBOLS = ["BTC-PERP", "ETH-PERP", "SOL-PERP"] as const satisfies readonly PerpSymbol[];

/** Commodities — HIP-3 dex `xyz` mark prices (`xyz:GOLD`, `xyz:SILVER`, `xyz:CL`). */
export const COMMODITY_PERP_SYMBOLS = ["GOLD-PERP", "SILVER-PERP", "OIL-PERP"] as const satisfies readonly PerpSymbol[];

export const PERP_SYMBOLS: PerpSymbol[] = [...MAIN_PERP_SYMBOLS, ...COMMODITY_PERP_SYMBOLS];

export const PERP_META: Record<
  PerpSymbol,
  { label: string; short: string; base: string }
> = {
  "BTC-PERP": { label: "Bitcoin", short: "BTC", base: "BTC" },
  "ETH-PERP": { label: "Ether", short: "ETH", base: "ETH" },
  "SOL-PERP": { label: "Solana", short: "SOL", base: "SOL" },
  "GOLD-PERP": { label: "Gold", short: "GOLD", base: "GOLD" },
  "SILVER-PERP": { label: "Silver", short: "SILV", base: "SILVER" },
  "OIL-PERP": { label: "Crude oil (CL)", short: "CL (OIL)", base: "CL" },
};

/** Default / seed index prices (USD). */
export const INITIAL_MARKS: Record<PerpSymbol, number> = {
  "BTC-PERP": 98_500,
  "ETH-PERP": 3_420,
  "SOL-PERP": 185.4,
  "GOLD-PERP": 4_750,
  "SILVER-PERP": 76,
  "OIL-PERP": 90,
};

/**
 * Single path: **prices → index return `p` → PnL / remaining** (no alternate formulas).
 *
 * `p = mark/entry − 1` (raw index move vs entry). Display “% vs entry” uses `p × 100`.
 * PnL uses signed return `r` = `p` long, `−p` short: `PnL = tokens × r × L`.
 * Remaining = `tokens + PnL` = `tokens × (1 + r × L)`.
 */
export function indexReturnDecimal(entryPrice: number, mark: number): number {
  if (entryPrice <= 0 || mark <= 0) return 0;
  return mark / entryPrice - 1;
}

/** Signed return for P&L: long `p`, short `−p` (same `p` as {@link indexReturnDecimal}). */
export function signedIndexReturnForPnl(side: "long" | "short", entryPrice: number, mark: number): number {
  const p = indexReturnDecimal(entryPrice, mark);
  return side === "long" ? p : -p;
}

/** `PnL = tokens × r × L` with `r` from {@link signedIndexReturnForPnl} — one path from prices. */
export function computeUnrealizedPnl(position: PerpPosition, mark: number): number {
  const { marginUsdc: tokens, leverage: L, side, entryPrice } = position;
  if (entryPrice <= 0 || mark <= 0 || tokens <= 0 || L <= 0) return 0;
  const r = signedIndexReturnForPnl(side, entryPrice, mark);
  return tokens * r * L;
}

/** Margin plus unrealized P&L (remaining collateral in QUSD terms). */
export function remainingMarginQusd(position: PerpPosition, mark: number): number {
  const { marginUsdc: tokens, leverage: L, entryPrice } = position;
  if (entryPrice <= 0 || mark <= 0 || tokens <= 0 || L <= 0) return tokens;
  const pnl = computeUnrealizedPnl(position, mark);
  return tokens + pnl;
}

/** Same as {@link remainingMarginQusd} — liquidation line when ≤ 0. */
export function positionNetQusd(position: PerpPosition, mark: number): number {
  return remainingMarginQusd(position, mark);
}

/** Treat near-zero as flat (floating-point). */
export const PERP_LIQUIDATION_NET_EPS = 1e-8;

/** True when remaining margin at this mark is exhausted (auto-close / liquidation). */
export function isLiquidatedAtMark(position: PerpPosition, mark: number): boolean {
  if (!(mark > 0) || !(position.entryPrice > 0) || !(position.marginUsdc > 0)) return false;
  return positionNetQusd(position, mark) <= PERP_LIQUIDATION_NET_EPS;
}

/** Index mid change vs entry, in percent — same `p` as PnL: `indexReturnDecimal × 100` (unsigned index move). */
export function marketPriceChangeSinceEntryPct(position: PerpPosition, mark: number): number {
  return indexReturnDecimal(position.entryPrice, mark) * 100;
}

/** Small random walk for demo marks (~±0.03% per tick). */
export function tickMarks(prev: Record<PerpSymbol, number>): Record<PerpSymbol, number> {
  const jitter = (p: number) => {
    const r = (Math.random() - 0.5) * 0.0006 * p;
    return Math.max(0.01, p + r);
  };
  const next = { ...prev };
  for (const sym of PERP_SYMBOLS) {
    next[sym] = jitter(prev[sym]);
  }
  return next;
}
