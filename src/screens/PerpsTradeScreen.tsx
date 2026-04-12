import { useMemo, useState, type CSSProperties } from "react";
import {
  computeUnrealizedPnl,
  DEFAULT_PERP_LEVERAGE,
  marketPriceChangeSinceEntryPct,
  positionNetQusd,
  type PerpPosition,
  type PerpSymbol,
  PERP_META,
  PERP_SYMBOLS,
} from "../engine/perps";
import type { InsuranceTierId } from "../engine/insuranceTiers";
import { getInsuranceTier } from "../engine/insuranceTiers";
import { QusdAmount, QusdIcon } from "../Qusd";

type Props = {
  marks: Record<PerpSymbol, number>;
  positions: PerpPosition[];
  onOpen: (args: {
    symbol: PerpSymbol;
    side: "long" | "short";
    notionalUsdc: number;
    leverage: number;
  }) => void;
  onClose: (positionId: string) => void;
  insuranceTierId: InsuranceTierId;
  /** Wired to the same `handleLoss` path as losing perp closes—pitch stats. */
  insurance?: {
    coveredLosses: number;
    premiumAccrued: number;
    coverageUsed: number;
    coverageLimit: number;
  };
  /** Live index feed (e.g. Hyperliquid allMids). */
  priceFeed?: {
    status: "connecting" | "live" | "partial";
    intervalMs: number;
    sourceLabel: string;
  };
  onNavigateToInsurance: () => void;
  onNavigateToAccount: () => void;
  qusdUnlocked: number;
  qusdLocked: number;
};

function directionLabel(side: "long" | "short"): "Up" | "Down" {
  return side === "long" ? "Up" : "Down";
}

export default function PerpsTradeScreen({
  marks,
  positions,
  onOpen,
  onClose,
  insuranceTierId,
  insurance,
  priceFeed,
  onNavigateToInsurance,
  onNavigateToAccount,
  qusdUnlocked,
  qusdLocked,
}: Props) {
  const [symbol, setSymbol] = useState<PerpSymbol>("BTC-PERP");
  const [side, setSide] = useState<"long" | "short">("long");
  const [allocateStr, setAllocateStr] = useState("1000");
  const [showMechanics, setShowMechanics] = useState(false);

  const allocateQusd = Math.max(0, Number(allocateStr) || 0);
  const margin = allocateQusd;
  /** Product rule: all perps run at 100× (not 1×). */
  const exposure = allocateQusd * DEFAULT_PERP_LEVERAGE;

  const mark = marks[symbol];

  const totalMargin = useMemo(
    () => positions.reduce((s, p) => s + p.marginUsdc, 0),
    [positions],
  );

  const totalUpl = useMemo(
    () =>
      positions.reduce((s, p) => {
        const m = marks[p.symbol];
        return s + computeUnrealizedPnl(p, m);
      }, 0),
    [positions, marks],
  );

  const totalNetQusd = useMemo(
    () =>
      positions.reduce((s, p) => {
        const m = marks[p.symbol];
        return s + positionNetQusd(p, m);
      }, 0),
    [positions, marks],
  );

  const activeTier = getInsuranceTier(insuranceTierId);

  const place = () => {
    if (allocateQusd <= 0) return;
    if (margin > qusdUnlocked + 1e-9) return;
    onOpen({ symbol, side, notionalUsdc: allocateQusd, leverage: DEFAULT_PERP_LEVERAGE });
  };

  return (
    <div style={s.wrap}>
      <div style={s.qusdPageStrip} aria-label="QUSD vault balances">
        <QusdIcon size={18} />
        <span style={s.qusdPageStripInner}>
          <span>Unlocked</span>{" "}
          <strong style={{ color: "var(--text)" }} className="mono">
            {formatUsd(qusdUnlocked)}
          </strong>{" "}
          <span style={s.qusdPageStripQ}>QUSD</span>
        </span>
        <span style={s.qusdPageStripSep}>·</span>
        <span style={s.qusdPageStripInner}>
          <span>Locked</span>{" "}
          <strong style={{ color: "var(--warn)" }} className="mono">
            {formatUsd(qusdLocked)}
          </strong>{" "}
          <span style={s.qusdPageStripQ}>QUSD</span>
        </span>
      </div>
      <div className="perps-layout">
        <div style={s.chartCard}>
          <div style={s.chartHeader}>
            <div style={s.chartHeaderRow}>
              <span style={s.chartTitle}>
                {priceFeed ? "Index mid (USD)" : "Price pulse (local)"}
              </span>
              <span style={s.chartHeaderActions}>
                {priceFeed && (
                  <span style={s.feedBadge}>
                    {priceFeed.status === "connecting" && (
                      <span style={{ color: "var(--muted)" }}>Connecting…</span>
                    )}
                    {priceFeed.status === "live" && (
                      <>
                        <span style={s.feedBrand}>{priceFeed.sourceLabel}</span>
                        <span style={s.feedSep}> · </span>
                        <span style={s.feedPollDim}>~{priceFeed.intervalMs / 1000}s</span>
                      </>
                    )}
                    {priceFeed.status === "partial" && (
                      <>
                        <span style={{ color: "var(--warn)", marginRight: 4 }}>Partial</span>
                        <span style={s.feedBrand}>{priceFeed.sourceLabel}</span>
                        <span style={s.feedSep}> · </span>
                        <span style={s.feedPollDim}>~{priceFeed.intervalMs / 1000}s</span>
                      </>
                    )}
                  </span>
                )}
              </span>
            </div>
          </div>
          <div className="perps-mark-grid" role="group" aria-label="Index mid prices (read-only)">
            {PERP_SYMBOLS.map((sym) => (
              <div key={sym} style={{ ...s.markCell, ...s.markCellDisplay }}>
                <span style={s.markSym}>{PERP_META[sym].short}</span>
                <span style={s.markPx}>{formatPrice(marks[sym])}</span>
              </div>
            ))}
          </div>
          <p style={s.chartHint}>
            {priceFeed
              ? `Hyperliquid: allMids for BTC, ETH, SOL; HIP-3 dex xyz markPx for GOLD, SILVER, CL (OIL). ~${priceFeed.intervalMs / 1000}s poll. Fixed ${DEFAULT_PERP_LEVERAGE}×: PnL = margin × (Δindex) × ${DEFAULT_PERP_LEVERAGE}; remaining = margin + PnL (≤0 ⇒ wiped).`
              : `Fixed ${DEFAULT_PERP_LEVERAGE}× leverage: PnL = margin × (Δindex) × ${DEFAULT_PERP_LEVERAGE}; remaining = margin + PnL. Updates on a timer—no funding or slip.`}
          </p>
        </div>

        <div className="perps-order-card" style={s.orderCard}>
          <div style={s.magnifyBanner}>
            <div style={s.magnifyBannerTop}>
              <p style={s.magnifyTitle}>Available</p>
              <button type="button" style={s.magnifyBuyBtn} onClick={onNavigateToAccount}>
                BUY
              </button>
            </div>
            <div style={s.magnifyQusdValue}>
              <QusdAmount
                value={qusdUnlocked}
                maximumFractionDigits={2}
                strong
                color="var(--accent)"
                iconSize={22}
                amountStyle={{ fontSize: "1.75rem", fontWeight: 700, letterSpacing: "-0.02em" }}
              />
            </div>
          </div>

          <div className="perps-tabs" style={s.tabs}>
            {PERP_SYMBOLS.map((sym) => (
              <button
                key={sym}
                type="button"
                style={{
                  ...s.tab,
                  ...(symbol === sym ? s.tabOn : {}),
                }}
                onClick={() => setSymbol(sym)}
              >
                {PERP_META[sym].short}
              </button>
            ))}
          </div>

          <div style={s.sideRow}>
            <button
              type="button"
              style={{ ...s.sideBtn, ...(side === "long" ? s.sideLongOn : {}) }}
              onClick={() => setSide("long")}
            >
              <span style={s.sidePrimary}>Up</span>
              <span style={s.sideSecondary}>long</span>
            </button>
            <button
              type="button"
              style={{ ...s.sideBtn, ...(side === "short" ? s.sideShortOn : {}) }}
              onClick={() => setSide("short")}
            >
              <span style={s.sidePrimary}>Down</span>
              <span style={s.sideSecondary}>short</span>
            </button>
          </div>

          <label style={s.field}>
            <span style={s.label}>Margin (QUSD tokens)</span>
            <input
              className="mono"
              value={allocateStr}
              onChange={(e) => setAllocateStr(e.target.value)}
              style={s.input}
              inputMode="decimal"
            />
          </label>

          <p style={s.leverageFixed}>
            <strong>{DEFAULT_PERP_LEVERAGE}×</strong> leverage{" "}
            <span style={{ color: "var(--muted)", fontWeight: 400 }}>(fixed)</span>
          </p>

          {showMechanics && (
            <div className="mono" style={s.est}>
              <div style={s.estRow}>
                <span style={{ color: "var(--muted)" }}>Mark {PERP_META[symbol].short}</span>
                <span>{formatPrice(mark)}</span>
              </div>
              <div style={s.estRow}>
                <span style={{ color: "var(--muted)" }}>Exposure (margin × lev)</span>
                <span>{formatUsd(exposure)}</span>
              </div>
            </div>
          )}

          <button
            type="button"
            style={{
              ...s.submit,
              ...(side === "long" ? s.submitLong : s.submitShort),
            }}
            disabled={margin > qusdUnlocked + 1e-9 || allocateQusd <= 0}
            onClick={place}
          >
            {directionLabel(side)} on {PERP_META[symbol].short}
            {showMechanics ? ` · market ${side} ${symbol}` : ""}
          </button>
          {margin > qusdUnlocked + 1e-9 && allocateQusd > 0 && (
            <p style={s.warn}>Allocate at most {formatUsd(qusdUnlocked)} QUSD (unlocked balance).</p>
          )}
        </div>
      </div>

      <div style={s.posCard}>
        <div style={s.posHead}>
          <div style={s.posHeadTitleRow}>
            <h2 style={{ ...s.h2, margin: 0 }}>Open positions</h2>
            <button type="button" style={s.mechanicsLink} onClick={() => setShowMechanics((v) => !v)}>
              {showMechanics ? "Hide" : "Show"} mechanics
            </button>
          </div>
          <div className="mono" style={s.posMeta}>
            {showMechanics && (
              <span>
                In allocation (QUSD) <span style={{ color: "var(--text)" }}>{formatUsd(totalMargin)}</span>
              </span>
            )}
            <span style={s.posMetaPlRow}>
              <QusdIcon size={14} />
              <span>
                QUSD (Profit/Loss){" "}
                <span style={{ color: totalUpl >= 0 ? "var(--ok)" : "var(--danger)" }}>
                  {totalUpl >= 0 ? "+" : ""}
                  {formatUsd(totalUpl)}
                </span>
              </span>
            </span>
            <span>
              Remaining{" "}
              <span style={{ color: totalNetQusd >= 0 ? "var(--text)" : "var(--danger)" }}>
                {totalNetQusd >= 0 ? "+" : ""}
                {formatUsd(totalNetQusd)}
              </span>
            </span>
          </div>
        </div>
        {positions.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>Nothing open—pick a direction to start.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table" style={{ width: "100%", fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Direction</th>
                  <th title="(Mark − Entry) / Entry · index move since open">% vs entry</th>
                  {showMechanics && (
                    <>
                      <th>Entry</th>
                      <th>Mark</th>
                      <th>Lev</th>
                      <th>Tokens</th>
                      <th>Exposure</th>
                    </>
                  )}
                  <th>{showMechanics ? "QUSD (Profit/Loss)" : "P/L"}</th>
                  <th title="Remaining = margin + PnL = tokens × (1 ± %×L) — ≤0 wiped">
                    {showMechanics ? "Remaining (liq)" : "Remaining"}
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const m = marks[p.symbol];
                  const upl = computeUnrealizedPnl(p, m);
                  const net = positionNetQusd(p, m);
                  const atWipe = net <= 1e-9;
                  const pct = marketPriceChangeSinceEntryPct(p, m);
                  return (
                    <tr key={p.id}>
                      <td>{PERP_META[p.symbol].short}</td>
                      <td>
                        <span style={{ color: p.side === "long" ? "var(--ok)" : "var(--danger)" }}>
                          {directionLabel(p.side)}
                        </span>
                        {showMechanics && (
                          <span style={{ color: "var(--muted)", fontSize: 11 }}> ({p.side})</span>
                        )}
                      </td>
                      <td
                        className="mono"
                        style={{
                          color: pct > 0 ? "var(--ok)" : pct < 0 ? "var(--danger)" : "var(--muted)",
                        }}
                      >
                        {formatPctSigned(pct)}
                      </td>
                      {showMechanics && (
                        <>
                          <td className="mono">{formatPrice(p.entryPrice)}</td>
                          <td className="mono">{formatPrice(m)}</td>
                          <td className="mono">{p.leverage}×</td>
                          <td className="mono">{formatUsd(p.marginUsdc)}</td>
                          <td className="mono">{formatUsd(p.notionalUsdc)}</td>
                        </>
                      )}
                      <td className="mono" style={{ color: upl >= 0 ? "var(--ok)" : "var(--danger)" }}>
                        <span aria-hidden style={{ marginRight: 4, opacity: 0.85 }}>
                          {upl >= 0 ? "↑" : "↓"}
                        </span>
                        {upl >= 0 ? "+" : ""}
                        {formatUsd(upl)}
                      </td>
                      <td className="mono">
                        <span
                          style={{
                            color: atWipe ? "var(--danger)" : net >= 0 ? "var(--ok)" : "var(--danger)",
                            fontWeight: atWipe ? 700 : undefined,
                          }}
                          title={`Margin ${formatUsd(p.marginUsdc)} + Δ ${upl >= 0 ? "+" : ""}${formatUsd(upl)}`}
                        >
                          {net >= 0 ? "+" : ""}
                          {formatUsd(net)}
                        </span>
                        {showMechanics && atWipe ? (
                          <span style={{ display: "block", fontSize: 10, color: "var(--danger)", marginTop: 2 }}>
                            wiped (remaining ≤ 0)
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <button type="button" style={s.closeBtn} onClick={() => onClose(p.id)}>
                          Close
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {insurance && (
        <div style={s.insuranceStrip}>
          <div style={s.insuranceStripInner}>
            <p style={s.insuranceStripTitle}>Smart Pool Insurance</p>
            <p style={s.insuranceStripBody}>
              Winning closes contribute to the pool by tier. Change tier on the{" "}
              <button type="button" style={s.insuranceNavLink} onClick={onNavigateToInsurance}>
                Insurance
              </button>{" "}
              tab when you have no open positions.{" "}
              {showMechanics && (
                <span style={{ color: "var(--muted)" }}>
                  Engine: pool covers losses up to your tier cap; then you pay; at cap, remaining positions close.
                </span>
              )}
            </p>
            <div style={s.activeTierOnly}>
              <p style={s.activeTierLabel}>Active coverage</p>
              <div style={s.activeTierRow}>
                <span style={s.activeTierBadge}>Tier {activeTier.id}</span>
                <span style={s.activeTierDetail}>
                  <strong>{(activeTier.winningsPct * 100).toFixed(0)}%</strong> of winnings to pool ·{" "}
                  <QusdIcon size={14} />
                  <span className="mono">{activeTier.maxLossCoveredQusd.toLocaleString()} QUSD</span> max insured losses
                </span>
              </div>
            </div>
            <div className="mono" style={s.insuranceMetrics}>
              <span style={s.insuranceMetricItem}>
                Pool paid for you:{" "}
                <QusdAmount value={insurance.coveredLosses} strong color="var(--ok)" />
              </span>
              <span style={{ color: "var(--muted)" }}>·</span>
              <span style={s.insuranceMetricItem}>
                Your contribution to pool:{" "}
                <QusdAmount value={insurance.premiumAccrued} strong color="var(--accent)" />
              </span>
              <span style={{ color: "var(--muted)" }}>·</span>
              <span style={{ ...s.insuranceMetricItem, alignItems: "center" }}>
                <QusdIcon size={14} />
                <span>
                  Coverage {formatUsd(insurance.coverageUsed)} / {formatUsd(insurance.coverageLimit)} QUSD
                </span>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatUsd(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Percent change vs entry (index), signed with +/.
 * Extra decimals for small |%| so the figure matches `PnL ≈ tokens × (%/100) × leverage` when checked by hand.
 */
function formatPctSigned(pct: number): string {
  const abs = Math.abs(pct);
  const digits =
    abs >= 100 || abs === 0 ? 2 : abs >= 1 ? 4 : 6;
  const s = pct.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  if (pct > 0) return `+${s}%`;
  if (pct < 0) return `${s}%`;
  return "0%";
}

function formatPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

const s: Record<string, CSSProperties> = {
  wrap: { display: "flex", flexDirection: "column", gap: 16 },
  qusdPageStrip: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px 14px",
    padding: "12px 16px",
    marginBottom: 4,
    borderRadius: 10,
    border: "1px solid color-mix(in srgb, var(--accent) 22%, var(--border))",
    background: "color-mix(in srgb, var(--accent) 6%, var(--surface))",
    fontSize: 13,
    color: "var(--muted)",
  },
  qusdPageStripInner: { display: "inline-flex", flexWrap: "wrap", alignItems: "baseline", gap: 6 },
  qusdPageStripQ: { fontWeight: 600, color: "var(--text)" },
  qusdPageStripSep: { opacity: 0.45, userSelect: "none" },
  insuranceStrip: {
    background: "linear-gradient(135deg, color-mix(in srgb, var(--ok) 8%, var(--panel)) 0%, var(--surface) 100%)",
    border: "1px solid color-mix(in srgb, var(--ok) 22%, var(--border))",
    borderRadius: 12,
    padding: "14px 18px",
  },
  insuranceStripInner: { maxWidth: 900 },
  insuranceStripTitle: {
    margin: "0 0 8px",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--ok)",
  },
  insuranceStripBody: {
    margin: "0 0 12px",
    fontSize: 13,
    lineHeight: 1.55,
    color: "var(--muted)",
  },
  insuranceCode: {
    fontFamily: "var(--mono)",
    fontSize: 12,
    color: "var(--accent)",
  },
  insuranceNavLink: {
    background: "none",
    border: "none",
    padding: 0,
    margin: 0,
    font: "inherit",
    fontWeight: 700,
    color: "var(--accent)",
    textDecoration: "underline",
    cursor: "pointer",
  },
  insuranceMetrics: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px 14px",
    fontSize: 12,
    alignItems: "center",
    marginTop: 12,
  },
  activeTierOnly: {
    marginTop: 14,
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid color-mix(in srgb, var(--accent) 28%, var(--border))",
    background: "color-mix(in srgb, var(--accent) 6%, var(--bg))",
  },
  activeTierLabel: {
    margin: "0 0 8px",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--accent)",
  },
  activeTierRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "10px 14px",
  },
  activeTierBadge: {
    fontSize: 12,
    fontWeight: 700,
    padding: "4px 10px",
    borderRadius: 8,
    background: "color-mix(in srgb, var(--accent) 18%, transparent)",
    color: "var(--text)",
  },
  activeTierDetail: {
    fontSize: 13,
    color: "var(--muted)",
    lineHeight: 1.5,
    display: "inline-flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  insuranceMetricItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    flexWrap: "wrap",
  },
  chartHeaderActions: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
  },
  mechanicsLink: {
    background: "none",
    border: "none",
    padding: 0,
    color: "var(--accent)",
    textDecoration: "underline",
    cursor: "pointer",
    font: "inherit",
    fontWeight: 600,
  },
  chartCard: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: "16px 14px",
    minWidth: 0,
  },
  chartHeader: { marginBottom: 12 },
  chartHeaderRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  chartTitle: {
    fontSize: 12,
    color: "var(--muted)",
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },
  feedBadge: {
    fontSize: 12,
    fontWeight: 600,
    display: "inline-flex",
    flexWrap: "wrap",
    alignItems: "center",
    fontFamily: "var(--font)",
  },
  feedBrand: { color: "var(--accent)" },
  feedSep: { color: "var(--accent)" },
  feedPollDim: { color: "var(--muted)", fontWeight: 500 },
  /** Index mid grid layout lives in `index.css` (`.perps-mark-grid`) for responsive columns. */
  markCell: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 6,
    padding: "12px 10px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--text)",
    textAlign: "left",
    outline: "none",
    boxShadow: "none",
  },
  /** Left panel: display-only; symbol is chosen in the order column only. */
  markCellDisplay: {
    cursor: "default",
    userSelect: "none",
    WebkitTapHighlightColor: "transparent",
  },
  markSym: {
    fontSize: 11,
    color: "var(--muted)",
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  markPx: {
    fontSize: 18,
    fontWeight: 700,
    color: "var(--text)",
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1.2,
  },
  chartHint: { margin: "14px 0 0", fontSize: 12, color: "var(--muted)", lineHeight: 1.5 },
  orderCard: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: 20,
    minWidth: 0,
  },
  h2: { fontSize: "1rem", fontWeight: 600, margin: 0, color: "var(--muted)" },
  tabs: {
    display: "flex",
    flexWrap: "nowrap",
    gap: 6,
    marginBottom: 14,
    minWidth: 0,
  },
  tab: {
    flex: "1 1 0",
    minWidth: 0,
    padding: "8px 6px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--muted)",
    fontWeight: 600,
    fontSize: 12,
  },
  tabOn: {
    borderColor: "color-mix(in srgb, var(--accent) 45%, var(--border))",
    color: "var(--text)",
    background: "color-mix(in srgb, var(--accent) 12%, var(--panel))",
  },
  sideRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 },
  sideBtn: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    padding: "12px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--muted)",
    fontWeight: 600,
  },
  sidePrimary: { fontSize: 16, fontWeight: 700, letterSpacing: "0.02em" },
  sideSecondary: { fontSize: 11, fontWeight: 500, opacity: 0.85, textTransform: "lowercase" },
  sideLongOn: {
    borderColor: "color-mix(in srgb, var(--accent) 50%, var(--border))",
    color: "var(--accent)",
    background: "color-mix(in srgb, var(--accent) 12%, var(--panel))",
  },
  sideShortOn: {
    borderColor: "color-mix(in srgb, var(--danger) 45%, var(--border))",
    color: "var(--danger)",
    background: "color-mix(in srgb, var(--danger) 12%, var(--panel))",
  },
  field: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 },
  leverageFixed: {
    margin: "0 0 12px",
    fontSize: 13,
    color: "var(--text)",
  },
  label: { fontSize: 12, color: "var(--muted)" },
  input: {
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--text)",
    padding: "10px 12px",
    fontSize: 15,
  },
  magnifyBanner: {
    background: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 12%, var(--panel)) 0%, var(--bg) 100%)",
    border: "1px solid color-mix(in srgb, var(--accent) 28%, var(--border))",
    borderRadius: 10,
    padding: "12px 14px",
    marginBottom: 16,
  },
  magnifyBannerTop: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 6,
  },
  magnifyBuyBtn: {
    background: "color-mix(in srgb, var(--accent) 20%, var(--panel))",
    border: "1px solid color-mix(in srgb, var(--accent) 45%, var(--border))",
    color: "color-mix(in srgb, var(--accent) 92%, #fff)",
    borderRadius: 8,
    padding: "8px 16px",
    fontWeight: 700,
    fontSize: 13,
    letterSpacing: "0.06em",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  magnifyTitle: {
    margin: 0,
    fontSize: 14,
    fontWeight: 700,
    color: "var(--text)",
    letterSpacing: "-0.02em",
  },
  magnifyQusdValue: {
    display: "flex",
    alignItems: "center",
    minHeight: "2.25rem",
  },
  est: {
    background: "var(--bg)",
    borderRadius: 8,
    padding: "12px 14px",
    marginBottom: 14,
    fontSize: 13,
  },
  estRow: { display: "flex", justifyContent: "space-between", marginBottom: 6 },
  submit: {
    width: "100%",
    padding: "14px 16px",
    borderRadius: 10,
    border: "none",
    fontWeight: 700,
    fontSize: 15,
    cursor: "pointer",
  },
  submitLong: {
    background: "color-mix(in srgb, var(--accent) 22%, var(--panel))",
    border: "1px solid color-mix(in srgb, var(--accent) 50%, var(--border))",
    color: "color-mix(in srgb, var(--accent) 90%, #fff)",
  },
  submitShort: {
    background: "color-mix(in srgb, var(--solved) 16%, var(--panel))",
    border: "1px solid color-mix(in srgb, var(--solved) 45%, var(--border))",
    color: "#fecaca",
  },
  warn: { color: "var(--danger)", fontSize: 12, margin: "10px 0 0" },
  posCard: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: 20,
  },
  posHead: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    marginBottom: 14,
  },
  posHeadTitleRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    width: "100%",
  },
  posMeta: { display: "flex", flexWrap: "wrap", gap: 16, fontSize: 13, color: "var(--muted)" },
  posMetaPlRow: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  },
  closeBtn: {
    background: "transparent",
    border: "1px solid var(--border)",
    color: "var(--text)",
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer",
  },
};
