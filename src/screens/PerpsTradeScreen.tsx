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
  /** Live index feed (e.g. Hyperliquid allMids). */
  priceFeed?: {
    status: "connecting" | "live" | "error";
    errorMessage?: string | null;
    intervalMs: number;
    sourceLabel: string;
  };
  onNavigateToAccount: () => void;
  /** Open Login / Register (demo users). */
  onGoToAuth?: () => void;
  /** False until signed-in user has verified Solana on Account; hide bonus banner when true. */
  bonusSetupComplete: boolean;
  /** Anonymous demo session — affects reminder copy. */
  isDemo: boolean;
  qusdUnlocked: number;
};

function directionLabel(side: "long" | "short"): "Up" | "Down" {
  return side === "long" ? "Up" : "Down";
}

export default function PerpsTradeScreen({
  marks,
  positions,
  onOpen,
  onClose,
  priceFeed,
  onNavigateToAccount,
  onGoToAuth,
  bonusSetupComplete,
  isDemo,
  qusdUnlocked,
}: Props) {
  const [symbol, setSymbol] = useState<PerpSymbol>("BTC-PERP");
  const [side, setSide] = useState<"long" | "short">("long");
  const [allocateStr, setAllocateStr] = useState("1000");
  const [showMechanics, setShowMechanics] = useState(false);

  const allocateQusd = Math.max(0, Number(allocateStr) || 0);
  const margin = allocateQusd;
  /** Product rule: all perps run at 100× (not 1×). */
  const exposure = allocateQusd * DEFAULT_PERP_LEVERAGE;

  const feedLive = priceFeed?.status === "live";

  const mark = marks[symbol];

  const totalMargin = useMemo(
    () => positions.reduce((s, p) => s + p.marginUsdc, 0),
    [positions],
  );

  const totalUpl = useMemo(
    () =>
      feedLive
        ? positions.reduce((s, p) => {
            const m = marks[p.symbol];
            return s + computeUnrealizedPnl(p, m);
          }, 0)
        : NaN,
    [positions, marks, feedLive],
  );

  const totalNetQusd = useMemo(
    () =>
      feedLive
        ? positions.reduce((s, p) => {
            const m = marks[p.symbol];
            return s + positionNetQusd(p, m);
          }, 0)
        : NaN,
    [positions, marks, feedLive],
  );

  const place = () => {
    if (!feedLive) return;
    if (allocateQusd <= 0) return;
    if (margin > qusdUnlocked + 1e-9) return;
    onOpen({ symbol, side, notionalUsdc: allocateQusd, leverage: DEFAULT_PERP_LEVERAGE });
  };

  const showBonusReminder = !bonusSetupComplete;

  return (
    <div style={s.wrap}>
      {showBonusReminder ? (
        <div style={s.bonusReminder} role="status">
          {isDemo ? (
            <p style={s.bonusReminderText}>
              <strong style={{ color: "var(--text)" }}>Bonus QUSD:</strong> Register with your email and verify a
              Solana address on{" "}
              <button type="button" style={s.bonusReminderBtn} onClick={onNavigateToAccount}>
                Account
              </button>{" "}
              to receive onboarding credits.{" "}
              {onGoToAuth ? (
                <button type="button" style={s.bonusReminderBtn} onClick={onGoToAuth}>
                  Login / Register
                </button>
              ) : null}
            </p>
          ) : (
            <p style={s.bonusReminderText}>
              <strong style={{ color: "var(--text)" }}>Bonus QUSD:</strong> Verify your Solana address on{" "}
              <button type="button" style={s.bonusReminderBtn} onClick={onNavigateToAccount}>
                Account
              </button>{" "}
              to receive your credit.
            </p>
          )}
        </div>
      ) : null}
      <div className="perps-layout">
        <div style={s.chartCard}>
          <div style={s.chartHeader}>
            <div style={s.chartHeaderRow}>
              <span style={s.chartTitle}>
                {feedLive ? "Index mid (USD)" : priceFeed?.status === "error" ? "Index unavailable" : "Index mid (USD)"}
              </span>
              <span style={s.chartHeaderActions}>
                {priceFeed ? (
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
                    {priceFeed.status === "error" && (
                      <span style={{ color: "var(--danger)", fontWeight: 600 }}>Feed error</span>
                    )}
                  </span>
                ) : null}
              </span>
            </div>
          </div>
          {priceFeed?.status === "error" && priceFeed.errorMessage ? (
            <p style={s.feedError} role="alert">
              {priceFeed.errorMessage}
            </p>
          ) : null}
          {priceFeed?.status === "connecting" ? (
            <p style={s.feedConnecting}>Loading Hyperliquid index prices…</p>
          ) : null}
          <div className="perps-mark-grid" role="group" aria-label="Index mid prices (read-only)">
            {PERP_SYMBOLS.map((sym) => (
              <div key={sym} style={{ ...s.markCell, ...s.markCellDisplay }}>
                <span style={s.markSym}>{PERP_META[sym].short}</span>
                <span style={s.markPx}>{feedLive ? formatPrice(marks[sym]) : "—"}</span>
              </div>
            ))}
          </div>
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
                <span>{feedLive ? formatPrice(mark) : "—"}</span>
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
            disabled={!feedLive || margin > qusdUnlocked + 1e-9 || allocateQusd <= 0}
            onClick={place}
          >
            {directionLabel(side)} on {PERP_META[symbol].short}
            {showMechanics ? ` · market ${side} ${symbol}` : ""}
          </button>
          {!feedLive ? (
            <p style={s.warn} role="status">
              Open trades are disabled until Hyperliquid prices load.
            </p>
          ) : null}
          {feedLive && margin > qusdUnlocked + 1e-9 && allocateQusd > 0 ? (
            <p style={s.warn}>Allocate at most {formatUsd(qusdUnlocked)} QUSD.</p>
          ) : null}
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
                {feedLive ? (
                  <span style={{ color: totalUpl >= 0 ? "var(--ok)" : "var(--danger)" }}>
                    {totalUpl >= 0 ? "+" : ""}
                    {formatUsd(totalUpl)}
                  </span>
                ) : (
                  <span style={{ color: "var(--muted)" }}>—</span>
                )}
              </span>
            </span>
            <span>
              Remaining{" "}
              {feedLive ? (
                <span style={{ color: totalNetQusd >= 0 ? "var(--text)" : "var(--danger)" }}>
                  {totalNetQusd >= 0 ? "+" : ""}
                  {formatUsd(totalNetQusd)}
                </span>
              ) : (
                <span style={{ color: "var(--muted)" }}>—</span>
              )}
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
                  const upl = feedLive ? computeUnrealizedPnl(p, m) : NaN;
                  const net = feedLive ? positionNetQusd(p, m) : NaN;
                  const atWipe = feedLive && net <= 1e-9;
                  const pct = feedLive ? marketPriceChangeSinceEntryPct(p, m) : NaN;
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
                          color: !feedLive
                            ? "var(--muted)"
                            : pct > 0
                              ? "var(--ok)"
                              : pct < 0
                                ? "var(--danger)"
                                : "var(--muted)",
                        }}
                      >
                        {feedLive ? formatPctSigned(pct) : "—"}
                      </td>
                      {showMechanics && (
                        <>
                          <td className="mono">{formatPrice(p.entryPrice)}</td>
                          <td className="mono">{feedLive ? formatPrice(m) : "—"}</td>
                          <td className="mono">{p.leverage}×</td>
                          <td className="mono">{formatUsd(p.marginUsdc)}</td>
                          <td className="mono">{formatUsd(p.notionalUsdc)}</td>
                        </>
                      )}
                      <td className="mono" style={{ color: upl >= 0 ? "var(--ok)" : "var(--danger)" }}>
                        {feedLive ? (
                          <>
                            <span aria-hidden style={{ marginRight: 4, opacity: 0.85 }}>
                              {upl >= 0 ? "↑" : "↓"}
                            </span>
                            {upl >= 0 ? "+" : ""}
                            {formatUsd(upl)}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="mono">
                        {feedLive ? (
                          <>
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
                          </>
                        ) : (
                          "—"
                        )}
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

      <p style={s.sessionFinePrint} role="note">
        Positions are not monitored while you are not using the app; when you log back in, they may be auto-liquidated
        based on current index prices.
      </p>
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
  bonusReminder: {
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid color-mix(in srgb, var(--warn) 35%, var(--border))",
    background: "color-mix(in srgb, var(--warn) 12%, var(--panel))",
    boxSizing: "border-box",
    maxWidth: "100%",
  },
  bonusReminderText: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.55,
    color: "var(--muted)",
  },
  bonusReminderBtn: {
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
  feedError: {
    margin: "0 0 12px",
    padding: "10px 12px",
    borderRadius: 8,
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--danger)",
    background: "color-mix(in srgb, var(--danger) 12%, var(--surface))",
    border: "1px solid color-mix(in srgb, var(--danger) 35%, var(--border))",
  },
  feedConnecting: { margin: "0 0 12px", fontSize: 13, color: "var(--muted)" },
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
  sessionFinePrint: {
    margin: "4px 0 0",
    fontSize: 11,
    lineHeight: 1.45,
    color: "var(--muted)",
    maxWidth: "min(42rem, 100%)",
  },
};
