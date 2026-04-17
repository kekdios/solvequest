import type { PerpSymbol } from "./perps";
import { fetchHyperliquidMidsCore } from "./hyperliquidMidsCore";

const DEFAULT_HL_INFO_URL = "https://api.hyperliquid.xyz/info";

function getHlInfoUrl(): string {
  const u = (import.meta.env.HYPERLIQUID_INFO_URL as string | undefined)?.trim();
  return u || DEFAULT_HL_INFO_URL;
}

/** Resolved info POST URL (from env or default). */
export function getHyperliquidInfoUrl(): string {
  return getHlInfoUrl();
}

function hlApiKey(): string | undefined {
  const key = (import.meta.env.HYPERLIQUID_API_KEY as string | undefined)?.trim();
  return key || undefined;
}

/**
 * Poll interval: conservative vs IP rate limits (allMids ≈ 2 weight; 1200 weight/min budget).
 * 5s ≈ 12 req/min → well under typical REST caps.
 */
export const HL_POLL_INTERVAL_MS = 5000;

export type HyperliquidMidsResult = {
  /** Full index set from Hyperliquid only; `null` if either API leg failed or the network errored. */
  marks: Record<PerpSymbol, number> | null;
  /** True when both main `allMids` and xyz `metaAndAssetCtxs` returned valid mids. */
  allLive: boolean;
};

/**
 * BTC/ETH/SOL mids from `allMids`; gold/silver/oil from HIP-3 `xyz` `markPx`.
 * Returns `marks: null` when either leg is missing — callers must not substitute placeholder prices.
 */
export async function fetchHyperliquidMids(signal?: AbortSignal): Promise<HyperliquidMidsResult> {
  const r = await fetchHyperliquidMidsCore({
    infoUrl: getHlInfoUrl(),
    apiKey: hlApiKey(),
    signal,
  });
  return { marks: r.marks, allLive: r.allLive };
}
