/**
 * Shared Hyperliquid index fetch (browser + Node). Pass URL and optional API key explicitly.
 */
import {
  COMMODITY_PERP_SYMBOLS,
  MAIN_PERP_SYMBOLS,
  type PerpSymbol,
} from "./perps";

const HL_MAIN_COIN: Record<(typeof MAIN_PERP_SYMBOLS)[number], string> = {
  "BTC-PERP": "BTC",
  "ETH-PERP": "ETH",
  "SOL-PERP": "SOL",
};

const HL_XYZ_COMMODITY: Record<(typeof COMMODITY_PERP_SYMBOLS)[number], string> = {
  "GOLD-PERP": "xyz:GOLD",
  "SILVER-PERP": "xyz:SILVER",
  "OIL-PERP": "xyz:CL",
};

function parseHlNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export type HyperliquidMidsCoreParams = {
  infoUrl: string;
  apiKey?: string;
  signal?: AbortSignal;
};

export type HyperliquidMidsCoreResult = {
  marks: Record<PerpSymbol, number> | null;
  allLive: boolean;
};

function postInfo(
  targetUrl: string,
  apiKey: string | undefined,
  body: object,
  signal?: AbortSignal,
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return fetch(targetUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
}

async function fetchMainDexMids(
  targetUrl: string,
  apiKey: string | undefined,
  signal?: AbortSignal,
): Promise<Record<(typeof MAIN_PERP_SYMBOLS)[number], number> | null> {
  const res = await postInfo(targetUrl, apiKey, { type: "allMids" }, signal);
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

async function fetchXyzCommodityMarks(
  targetUrl: string,
  apiKey: string | undefined,
  signal?: AbortSignal,
): Promise<Record<(typeof COMMODITY_PERP_SYMBOLS)[number], number> | null> {
  const res = await postInfo(targetUrl, apiKey, { type: "metaAndAssetCtxs", dex: "xyz" }, signal);
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

/**
 * BTC/ETH/SOL from `allMids`; commodities from HIP-3 `xyz` `markPx`.
 */
export async function fetchHyperliquidMidsCore(
  params: HyperliquidMidsCoreParams,
): Promise<HyperliquidMidsCoreResult> {
  const { infoUrl, apiKey, signal } = params;
  let main: Awaited<ReturnType<typeof fetchMainDexMids>> = null;
  let xyz: Awaited<ReturnType<typeof fetchXyzCommodityMarks>> = null;
  try {
    [main, xyz] = await Promise.all([
      fetchMainDexMids(infoUrl, apiKey, signal),
      fetchXyzCommodityMarks(infoUrl, apiKey, signal),
    ]);
  } catch {
    /* network */
  }

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  if (main === null || xyz === null) {
    return { marks: null, allLive: false };
  }

  return {
    marks: { ...main, ...xyz } as Record<PerpSymbol, number>,
    allLive: true,
  };
}
