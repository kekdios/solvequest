import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { uiBtnGhost, uiOrderCard } from "../ui/appSurface";
import { PERP_META, type PerpSymbol } from "../engine/perps";

type CloseRow = {
  id: number;
  position_id: string;
  symbol: string;
  side: string;
  entry_price: number | null;
  exit_price: number | null;
  notional_usdc: number | null;
  leverage: number | null;
  margin_usdc: number | null;
  opened_at: number | null;
  realized_pnl_qusd: number | null;
  closed_at: number | null;
};

type Props = {
  isDemo: boolean;
};

const PAGE_SIZE = 20;

function fmtNum(n: number | null | undefined, d = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(d);
}

function fmtTs(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function HistoryScreen({ isDemo }: Props) {
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<CloseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    if (isDemo) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/account/perp-closes?page=${p}&page_size=${PAGE_SIZE}`, {
        credentials: "include",
      });
      if (!r.ok) {
        setError(r.status === 401 ? "Sign in to view trade history." : "Could not load history.");
        setRows([]);
        setTotal(0);
        return;
      }
      const data = (await r.json()) as {
        closes: CloseRow[];
        total: number;
        page: number;
        page_size: number;
      };
      setRows(data.closes ?? []);
      setTotal(Number(data.total) || 0);
      setPage(Number(data.page) || p);
    } catch {
      setError("Network error.");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [isDemo]);

  useEffect(() => {
    void load(1);
  }, [load, isDemo]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (isDemo) {
    return (
      <div className="app-page" style={s.wrap}>
        <p style={s.muted}>
          Trade history is saved to your account after you register. In demo mode, closes stay in this browser only.
        </p>
      </div>
    );
  }

  return (
    <div className="app-page" style={s.wrap}>
      {error ? (
        <p style={s.err} role="alert">
          {error}
        </p>
      ) : null}
      {loading && rows.length === 0 ? <p style={s.muted}>Loading…</p> : null}

      {!loading && !error && rows.length === 0 ? (
        <p style={s.muted}>No closed trades yet. Close a position on Perpetuals to see it here.</p>
      ) : null}

      {rows.length > 0 ? (
        <>
          <div style={{ ...uiOrderCard, padding: 0, overflow: "auto" }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Closed</th>
                  <th style={s.th}>Market</th>
                  <th style={s.th}>Side</th>
                  <th style={{ ...s.th, ...s.num }}>Entry</th>
                  <th style={{ ...s.th, ...s.num }}>Exit</th>
                  <th style={{ ...s.th, ...s.num }}>Margin</th>
                  <th style={{ ...s.th, ...s.num }}>Lev</th>
                  <th style={{ ...s.th, ...s.num }}>Realized P/L (QUSD)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const sym = r.symbol as PerpSymbol;
                  const label = PERP_META[sym]?.short ?? r.symbol;
                  const pnl = r.realized_pnl_qusd ?? 0;
                  return (
                    <tr key={`${r.id}-${r.position_id}`}>
                      <td style={s.td}>{fmtTs(r.closed_at)}</td>
                      <td style={s.td}>{label}</td>
                      <td style={s.td}>{r.side === "long" ? "Long" : "Short"}</td>
                      <td style={{ ...s.td, ...s.num }} className="mono">
                        {fmtNum(r.entry_price, 4)}
                      </td>
                      <td style={{ ...s.td, ...s.num }} className="mono">
                        {fmtNum(r.exit_price, 4)}
                      </td>
                      <td style={{ ...s.td, ...s.num }} className="mono">
                        {fmtNum(r.margin_usdc)}
                      </td>
                      <td style={{ ...s.td, ...s.num }} className="mono">
                        {r.leverage != null ? `${Math.round(r.leverage)}×` : "—"}
                      </td>
                      <td
                        style={{
                          ...s.td,
                          ...s.num,
                          color: pnl >= 0 ? "var(--ok)" : "var(--danger)",
                          fontWeight: 600,
                        }}
                        className="mono"
                      >
                        {pnl >= 0 ? "+" : ""}
                        {fmtNum(r.realized_pnl_qusd)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={s.pager}>
            <button
              type="button"
              style={{ ...uiBtnGhost, opacity: page <= 1 ? 0.45 : 1 }}
              disabled={page <= 1 || loading}
              onClick={() => void load(page - 1)}
            >
              Previous
            </button>
            <span style={s.pagerMeta} className="mono">
              Page {page} / {totalPages} · {total} total
            </span>
            <button
              type="button"
              style={{ ...uiBtnGhost, opacity: page >= totalPages ? 0.45 : 1 }}
              disabled={page >= totalPages || loading}
              onClick={() => void load(page + 1)}
            >
              Next
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  wrap: { maxWidth: 960, margin: "0 auto" },
  muted: { margin: 0, fontSize: 14, color: "var(--muted)", lineHeight: 1.55 },
  err: { margin: "0 0 12px", color: "var(--danger)", fontSize: 14 },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  th: {
    textAlign: "left" as const,
    padding: "10px 12px",
    borderBottom: "1px solid var(--border)",
    color: "var(--muted)",
    fontWeight: 600,
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  },
  td: {
    padding: "10px 12px",
    borderBottom: "1px solid color-mix(in srgb, var(--border) 70%, transparent)",
    color: "var(--text)",
  },
  num: { textAlign: "right" as const, whiteSpace: "nowrap" as const },
  pager: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    marginTop: 18,
  },
  pagerMeta: { fontSize: 13, color: "var(--muted)" },
};
