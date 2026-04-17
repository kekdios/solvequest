/**
 * Server-authoritative checks for PUT /api/account/state: perp settlement math and snapshot integrity.
 */
import type { PerpSymbol, PerpPosition } from "../src/engine/perps";
import { computeUnrealizedPnl } from "../src/engine/perps";
import { fetchHyperliquidMidsCore } from "../src/engine/hyperliquidMidsCore";

const DEFAULT_HL_INFO = "https://api.hyperliquid.xyz/info";

/** Max relative deviation of client exit vs Hyperliquid mark at settlement time. */
const DEFAULT_EXIT_MAX_REL = 0.15;

/** Tolerance for comparing client-reported UPL to server recomputation. */
const UPL_ABS_EPS = 1e-4;
const UPL_REL_EPS = 1e-9;

/** Notional must equal margin × leverage (position geometry). */
const NOTIONAL_REL_EPS = 1e-6;

export type AccountSnapshotRow = {
  usdc_balance: number;
  coverage_limit_qusd: number;
  premium_accrued_usdc: number;
  covered_losses_qusd: number;
  coverage_used_qusd: number;
  accumulated_losses_qusd: number;
  bonus_repaid_usdc: number;
};

export type PerpCloseEventIn = {
  positionId: string;
  symbol: PerpSymbol;
  side: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  notionalUsdc: number;
  leverage: number;
  marginUsdc: number;
  openedAt: number;
  realizedPnlQusd: number;
  closedAt: number;
};

export type PerpOpenIn = {
  id: string;
  symbol: PerpSymbol;
  side: "long" | "short";
  entryPrice: number;
  notionalUsdc: number;
  leverage: number;
  marginUsdc: number;
  openedAt: number;
};

export type DbPerpOpenRow = {
  position_id: string;
  symbol: string;
  side: string;
  entry_price: number;
  notional_usdc: number;
  leverage: number;
  margin_usdc: number;
  opened_at: number;
};

function almostEqual(a: number, b: number, absEps = UPL_ABS_EPS, relEps = UPL_REL_EPS): boolean {
  const d = Math.abs(a - b);
  if (d <= absEps) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return d <= relEps * scale;
}

/** Client must echo current DB account columns (prevents arbitrary USDC/coverage edits). */
export function accountSnapshotMatchesDb(
  body: {
    usdc_balance: number;
    coverage_limit_qusd: number;
    premium_accrued_usdc: number;
    covered_losses_qusd: number;
    coverage_used_qusd: number;
    accumulated_losses_qusd: number;
    bonus_repaid_usdc: number;
  },
  row: AccountSnapshotRow,
): boolean {
  return (
    almostEqual(body.usdc_balance, row.usdc_balance) &&
    almostEqual(body.coverage_limit_qusd, row.coverage_limit_qusd) &&
    almostEqual(body.premium_accrued_usdc, row.premium_accrued_usdc) &&
    almostEqual(body.covered_losses_qusd, row.covered_losses_qusd) &&
    almostEqual(body.coverage_used_qusd, row.coverage_used_qusd) &&
    almostEqual(body.accumulated_losses_qusd, row.accumulated_losses_qusd) &&
    almostEqual(body.bonus_repaid_usdc, row.bonus_repaid_usdc)
  );
}

function perpPositionFromDb(r: DbPerpOpenRow): PerpPosition {
  return {
    id: r.position_id,
    symbol: r.symbol as PerpSymbol,
    side: r.side as "long" | "short",
    entryPrice: r.entry_price,
    notionalUsdc: r.notional_usdc,
    leverage: r.leverage,
    marginUsdc: r.margin_usdc,
    openedAt: r.opened_at,
  };
}

function closeEventMatchesDbRow(e: PerpCloseEventIn, r: DbPerpOpenRow): boolean {
  return (
    e.symbol === r.symbol &&
    e.side === r.side &&
    almostEqual(e.entryPrice, r.entry_price) &&
    almostEqual(e.notionalUsdc, r.notional_usdc) &&
    almostEqual(e.leverage, r.leverage) &&
    almostEqual(e.marginUsdc, r.margin_usdc) &&
    e.openedAt === r.opened_at
  );
}

function openBodyMatchesDbRow(p: PerpOpenIn, r: DbPerpOpenRow): boolean {
  return (
    p.symbol === r.symbol &&
    p.side === r.side &&
    almostEqual(p.entryPrice, r.entry_price) &&
    almostEqual(p.notionalUsdc, r.notional_usdc) &&
    almostEqual(p.leverage, r.leverage) &&
    almostEqual(p.marginUsdc, r.margin_usdc) &&
    p.openedAt === r.opened_at
  );
}

export function notionallyConsistent(margin: number, leverage: number, notional: number): boolean {
  if (!(margin > 0) || !(leverage > 0)) return false;
  return almostEqual(margin * leverage, notional, 1e-3, NOTIONAL_REL_EPS);
}

function exitPriceVsMarkOk(exitPrice: number, mark: number, maxRel: number): boolean {
  if (!(exitPrice > 0) || !(mark > 0)) return false;
  return Math.abs(exitPrice - mark) / mark <= maxRel;
}

export type CloseSettlement = {
  positionId: string;
  creditQusd: number;
  serverUpl: number;
};

export type ValidateClosesResult =
  | { ok: true; settlements: CloseSettlement[] }
  | { ok: false; status: number; error: string; message: string };

/**
 * Validates closes against DB opens + Hyperliquid marks; returns server-computed settlement credits.
 */
export async function validatePerpClosesAndBuildSettlements(
  env: Record<string, string>,
  dbOpens: DbPerpOpenRow[],
  closes: PerpCloseEventIn[],
): Promise<ValidateClosesResult> {
  if (closes.length === 0) {
    return { ok: true, settlements: [] };
  }

  const byId = new Map(dbOpens.map((r) => [r.position_id, r]));
  const infoUrl = (env.HYPERLIQUID_INFO_URL ?? "").trim() || DEFAULT_HL_INFO;
  const apiKey = (env.HYPERLIQUID_API_KEY ?? "").trim() || undefined;
  const maxRel = Math.min(
    0.5,
    Math.max(
      1e-6,
      Number.parseFloat(env.ACCOUNT_STATE_EXIT_MAX_VS_MARK_REL ?? "") || DEFAULT_EXIT_MAX_REL,
    ),
  );

  let marks;
  try {
    const { marks: m } = await fetchHyperliquidMidsCore({
      infoUrl,
      apiKey,
      signal: AbortSignal.timeout(12_000),
    });
    marks = m;
  } catch {
    marks = null;
  }

  if (!marks) {
    return {
      ok: false,
      status: 503,
      error: "price_feed_unavailable",
      message: "Could not load Hyperliquid marks to validate perp closes. Try again shortly.",
    };
  }

  const settlements: CloseSettlement[] = [];

  for (const e of closes) {
    const row = byId.get(e.positionId);
    if (!row) {
      return {
        ok: false,
        status: 400,
        error: "unknown_close",
        message: "Close references a position that is not open on the server. Refresh and retry.",
      };
    }
    if (!closeEventMatchesDbRow(e, row)) {
      return {
        ok: false,
        status: 400,
        error: "close_payload_mismatch",
        message: "Close event does not match the server’s open position. Refresh and retry.",
      };
    }

    const mark = marks[e.symbol];
    if (!(mark > 0)) {
      return {
        ok: false,
        status: 503,
        error: "price_feed_incomplete",
        message: `Missing Hyperliquid mark for ${e.symbol}.`,
      };
    }
    if (!exitPriceVsMarkOk(e.exitPrice, mark, maxRel)) {
      return {
        ok: false,
        status: 400,
        error: "exit_price_vs_mark",
        message: `Exit price for ${e.symbol} is too far from the current index (max ${(maxRel * 100).toFixed(1)}% from Hyperliquid). Refresh marks and try again.`,
      };
    }

    const pos = perpPositionFromDb(row);
    const serverUpl = computeUnrealizedPnl(pos, e.exitPrice);
    const creditQusd = pos.marginUsdc + serverUpl;
    settlements.push({ positionId: e.positionId, creditQusd, serverUpl });
  }

  return { ok: true, settlements };
}

export type ValidateOpensResult =
  | { ok: true }
  | { ok: false; status: number; error: string; message: string };

export function validateDuplicateCloseIds(closes: PerpCloseEventIn[]): ValidateOpensResult {
  const ids = new Set<string>();
  for (const e of closes) {
    if (ids.has(e.positionId)) {
      return {
        ok: false,
        status: 400,
        error: "duplicate_close",
        message: "Duplicate close for the same position in one request.",
      };
    }
    ids.add(e.positionId);
  }
  return { ok: true };
}

export function validateOpensAndClosesDisjoint(
  closes: PerpCloseEventIn[],
  opens: PerpOpenIn[],
): ValidateOpensResult {
  const closeIds = new Set(closes.map((c) => c.positionId));
  for (const p of opens) {
    if (closeIds.has(p.id)) {
      return {
        ok: false,
        status: 400,
        error: "open_close_overlap",
        message: "Cannot list a position as both closing and open.",
      };
    }
  }
  return { ok: true };
}

/** Validates new opens (geometry) and unchanged re-sent opens (match prior DB row). */
export function validateOpenPositionsForPut(
  prevOpenIds: Set<string>,
  dbById: Map<string, DbPerpOpenRow>,
  opens: PerpOpenIn[],
): ValidateOpensResult {
  const seen = new Set<string>();
  for (const p of opens) {
    if (seen.has(p.id)) {
      return {
        ok: false,
        status: 400,
        error: "duplicate_open_id",
        message: "Duplicate position id in open_perp_positions.",
      };
    }
    seen.add(p.id);

    if (prevOpenIds.has(p.id)) {
      const row = dbById.get(p.id);
      if (!row) {
        return {
          ok: false,
          status: 400,
          error: "open_id_missing",
          message: "Stale position reference. Refresh and retry.",
        };
      }
      if (!openBodyMatchesDbRow(p, row)) {
        return {
          ok: false,
          status: 400,
          error: "open_payload_mismatch",
          message: "Open position does not match the server copy. Refresh and retry.",
        };
      }
    } else {
      if (!notionallyConsistent(p.marginUsdc, p.leverage, p.notionalUsdc)) {
        return {
          ok: false,
          status: 400,
          error: "invalid_notional",
          message: "notional_usdc must equal margin × leverage for new positions.",
        };
      }
    }
  }
  return { ok: true };
}
