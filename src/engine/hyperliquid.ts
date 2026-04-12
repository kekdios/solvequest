import {
  COMMODITY_PERP_SYMBOLS,
  INITIAL_MARKS,
  MAIN_PERP_SYMBOLS,
  type PerpSymbol,
} from "./perps";

const DEFAULT_HL_INFO_URL = "https://api.hyperliquid.xyz/info";

function getHlInfoUrl(): string {
  const u = (import.meta.env.HYPERLIQUID_INFO_URL as string | undefined)?.trim();
  return u || DEFAULT_HL_INFO_URL;
}

/** Resolved info POST URL (from env or default). */
export function getHyperliquidInfoUrl(): string {
  return getHlInfoUrl();
}

function hlAuthHeaders(): Record<string, string> {
  const key = (import.meta.env.HYPERLIQUID_API_KEY as string | undefined)?.trim();
  if (!key) return {};
  return { Authorization: `Bearer ${key}` };
}

function postInfo(body: object, signal?: AbortSignal): Promise<Response> {
  return fetch(getHlInfoUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...hlAuthHeaders(),
    },
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * Poll interval: conservative vs IP rate limits (allMids ≈ 2 weight; 1200 weight/min budget).
 * 5s ≈ 12 req/min → well under typical REST caps.
 */
export const HL_POLL_INTERVAL_MS = 5000;

/** Main dex: `allMids` keys. */
const HL_MAIN_COIN: Record<(typeof MAIN_PERP_SYMBOLS)[number], string> = {
  "BTC-PERP": "BTC",
  "ETH-PERP": "ETH",
  "SOL-PERP": "SOL",
};

/** HIP-3 dex `xyz`: commodity perp asset names in meta. */
const HL_XYZ_COMMODITY: Record<(typeof COMMODITY_PERP_SYMBOLS)[number], string> = {
  "GOLD-PERP": "xyz:GOLD",
  "SILVER-PERP": "xyz:SILVER",
  "OIL-PERP": "xyz:CL",
};

function commodityFallback(): Record<(typeof COMMODITY_PERP_SYMBOLS)[number], number> {
  return {
    "GOLD-PERP": INITIAL_MARKS["GOLD-PERP"],
    "SILVER-PERP": INITIAL_MARKS["SILVER-PERP"],
    "OIL-PERP": INITIAL_MARKS["OIL-PERP"],
  };
}

function mainFallback(): Record<(typeof MAIN_PERP_SYMBOLS)[number], number> {
  return {
    "BTC-PERP": INITIAL_MARKS["BTC-PERP"],
    "ETH-PERP": INITIAL_MARKS["ETH-PERP"],
    "SOL-PERP": INITIAL_MARKS["SOL-PERP"],
  };
}

/** HL JSON sometimes uses strings; be tolerant of numbers too. */
function parseHlNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

async function fetchMainDexMids(signal?: AbortSignal): Promise<Record<(typeof MAIN_PERP_SYMBOLS)[number], number> | null> {
  const res = await postInfo({ type: "allMids" }, signal);
  if (!res.ok) return null;

  const data: unknown = await res.json();
  if (!data || typeof data !== "object") return null;
  const mids = data as Record<string, unknown>;

  const out: Partial<Record<(typeof MAIN_PERP_SYMBOLS)[number], number>> = {};
  for (const sym of MAIN_PERP_SYMBOLS) {
    const n = parseHlNumber(mids[HL_MAIN_COIN[sym]]);
    if (n === null) return null;
    out[sym] = n;
  }
  return out as Record<(typeof MAIN_PERP_SYMBOLS)[number], number>;
}

/**
 * Gold / silver / oil marks from HIP-3 dex `xyz` (`metaAndAssetCtxs` markPx).
 */
async function fetchXyzCommodityMarks(signal?: AbortSignal): Promise<Record<
  (typeof COMMODITY_PERP_SYMBOLS)[number],
  number
> | null> {
  const res = await postInfo({ type: "metaAndAssetCtxs", dex: "xyz" }, signal);
  if (!res.ok) return null;

  const data: unknown = await res.json();
  if (!Array.isArray(data) || data.length < 2) return null;
  const meta = data[0] as { universe?: { name: string }[] };
  const ctxs = data[1] as { markPx?: string }[];
  if (!meta?.universe || !Array.isArray(ctxs)) return null;

  const names = meta.universe.map((u) => u.name);
  const out: Partial<Record<(typeof COMMODITY_PERP_SYMBOLS)[number], number>> = {};

  for (const sym of COMMODITY_PERP_SYMBOLS) {
    const hlName = HL_XYZ_COMMODITY[sym];
    const idx = names.indexOf(hlName);
    if (idx < 0 || idx >= ctxs.length) return null;
    const n = parseHlNumber(ctxs[idx]?.markPx);
    if (n === null) return null;
    out[sym] = n;
  }

  return out as Record<(typeof COMMODITY_PERP_SYMBOLS)[number], number>;
}

export type HyperliquidMidsResult = {
  marks: Record<PerpSymbol, number>;
  /** True when both main `allMids` and xyz `metaAndAssetCtxs` succeeded. */
  allLive: boolean;
};

/**
 * BTC/ETH/SOL mids from `allMids`; gold/silver/oil from HIP-3 `xyz` `markPx`.
 * Always returns usable marks: failed legs use {@link INITIAL_MARKS} / commodity fallbacks.
 */
export async function fetchHyperliquidMids(signal?: AbortSignal): Promise<HyperliquidMidsResult> {
  let main: Awaited<ReturnType<typeof fetchMainDexMids>> = null;
  let xyz: Awaited<ReturnType<typeof fetchXyzCommodityMarks>> = null;
  try {
    [main, xyz] = await Promise.all([fetchMainDexMids(signal), fetchXyzCommodityMarks(signal)]);
  } catch {
    // Network / CORS — treat as missing legs below.
  }

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const mainMarks = main ?? mainFallback();
  const commodities = xyz ?? commodityFallback();
  const allLive = main !== null && xyz !== null;

  return {
    marks: { ...mainMarks, ...commodities } as Record<PerpSymbol, number>,
    allLive,
  };
}
