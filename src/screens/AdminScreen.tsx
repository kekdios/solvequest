import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useSessionAuth } from "../auth/sessionAuth";
import { uiBtnGhost, uiBtnPrimary } from "../ui/appSurface";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function fmtTs(ms: number): string {
  const d = new Date(ms);
  const day = String(d.getDate()).padStart(2, "0");
  const mon = MON[d.getMonth()]!;
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${day}-${mon}-${yy} ${hh}:${min}`;
}

const SOLSCAN = "https://solscan.io/account";

type AddrBalance = {
  address: string | null;
  valid: boolean;
  usdc_ui: number | null;
  sol_lamports: number | null;
  error?: string;
};

type SwapRow = {
  id: number;
  account_id: string;
  created_at: number;
  swap_id: string;
  account_email: string | null;
  qusd_debited: number;
};

type ErrRow = {
  id: number;
  account_id: string;
  created_at: number;
  swap_id: string;
  account_email: string | null;
  qusd_refunded: number;
  message: string;
};

type DashboardPayload = {
  env: Record<string, string>;
  treasury: AddrBalance;
  receive_address: AddrBalance;
  swaps: { page: number; page_size: number; total: number; rows: SwapRow[] };
  swap_errors: { page: number; page_size: number; total: number; rows: ErrRow[] };
};

type DepositScanAccountReport = {
  account_id: string;
  sol_receive_address: string;
  status: "ok" | "error" | "skipped";
  error?: string;
  lines: string[];
};

function solscanAccountUrl(addr: string): string {
  return `${SOLSCAN}/${encodeURIComponent(addr)}`;
}

function fmtSol(lamports: number | null): string {
  if (lamports == null) return "—";
  return (lamports / 1e9).toFixed(6);
}

function scanStatusColor(status: DepositScanAccountReport["status"]): string {
  if (status === "ok") return "var(--ok)";
  if (status === "error") return "var(--danger)";
  return "var(--warn)";
}

export default function AdminScreen() {
  const { authLoading, user, refreshUser } = useSessionAuth();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [depositScanBusy, setDepositScanBusy] = useState(false);
  const [depositScanErr, setDepositScanErr] = useState<string | null>(null);
  const [depositScanOk, setDepositScanOk] = useState<string | null>(null);
  const [depositScanReports, setDepositScanReports] = useState<DepositScanAccountReport[] | null>(null);
  const dataRef = useRef<DashboardPayload | null>(null);
  dataRef.current = data;

  const load = useCallback(
    async (sp: number, ep: number) => {
      if (authLoading || !user) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        let r = await fetch(`/api/admin/swap-dashboard?swaps_page=${sp}&errors_page=${ep}`, {
          credentials: "include",
        });
        if (r.status === 401) {
          await refreshUser();
          r = await fetch(`/api/admin/swap-dashboard?swaps_page=${sp}&errors_page=${ep}`, {
            credentials: "include",
          });
        }
        if (r.status === 403) {
          setError("You do not have access to this page.");
          setData(null);
          return;
        }
        if (!r.ok) {
          setError(r.status === 401 ? "Sign in required." : "Could not load admin data.");
          setData(null);
          return;
        }
        setData((await r.json()) as DashboardPayload);
      } catch {
        setError("Network error.");
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [authLoading, user, refreshUser],
  );

  useEffect(() => {
    void load(1, 1);
  }, [load]);

  const runDepositScan = useCallback(async () => {
    if (authLoading || !user || depositScanBusy) return;
    setDepositScanBusy(true);
    setDepositScanErr(null);
    setDepositScanOk(null);
    setDepositScanReports(null);
    try {
      let r = await fetch("/api/admin/run-deposit-scan", {
        method: "POST",
        credentials: "include",
      });
      if (r.status === 401) {
        await refreshUser();
        r = await fetch("/api/admin/run-deposit-scan", {
          method: "POST",
          credentials: "include",
        });
      }
      if (r.status === 403) {
        setDepositScanErr("You do not have permission to run the scanner.");
        return;
      }
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        accounts_scanned?: number;
        error?: string;
        reports?: DepositScanAccountReport[];
      };
      if (!r.ok || j.ok === false) {
        setDepositScanErr(j.error || `Scan failed (${r.status}).`);
        return;
      }
      const n = j.accounts_scanned ?? 0;
      setDepositScanOk(`Scan finished. Accounts in pass: ${n}. Step-by-step output below.`);
      setDepositScanReports(Array.isArray(j.reports) ? j.reports : []);
      const cur = dataRef.current;
      void load(cur?.swaps.page ?? 1, cur?.swap_errors.page ?? 1);
    } catch {
      setDepositScanErr("Network error.");
    } finally {
      setDepositScanBusy(false);
    }
  }, [authLoading, user, depositScanBusy, refreshUser, load]);

  const envRows = data
    ? [
        ["SOLANA_TREASURY_ADDRESS", data.env.SOLANA_TREASURY_ADDRESS],
        ["SWAP_ABOVE_AMOUNT", data.env.SWAP_ABOVE_AMOUNT],
        ["SWAP_QUSD_USDC_RATE", data.env.SWAP_QUSD_USDC_RATE],
        ["SWAP_USDC_QUSD_RATE", data.env.SWAP_USDC_QUSD_RATE],
        ["SWAP_USDC_RECEIVE_ADDRESS", data.env.SWAP_USDC_RECEIVE_ADDRESS],
        ["SWAP_MAXIMUM_USDC_AMOUNT", data.env.SWAP_MAXIMUM_USDC_AMOUNT],
      ]
    : [];

  const rateParsed = data ? Number.parseFloat(data.env.SWAP_QUSD_USDC_RATE || "") : NaN;
  const rateOk = Number.isFinite(rateParsed) && rateParsed > 0;

  const swaps = data?.swaps;
  const errs = data?.swap_errors;
  const swapPageSize = swaps?.page_size ?? 20;
  const errPageSize = errs?.page_size ?? 20;
  const swapTotalPages = swaps ? Math.max(1, Math.ceil(swaps.total / swapPageSize)) : 1;
  const errTotalPages = errs ? Math.max(1, Math.ceil(errs.total / errPageSize)) : 1;

  return (
    <div className="app-page" style={s.wrap}>
      {error ? (
        <p role="alert" style={{ color: "var(--danger)", marginBottom: 12 }}>
          {error}
        </p>
      ) : null}

      {loading && !data ? <p style={{ color: "var(--muted)" }}>Loading…</p> : null}

      {data ? (
        <>
          <section style={s.section}>
            <h2 className="app-section-title" style={s.h2}>
              USDC deposit scanner
            </h2>
            <p style={{ ...s.mutedP, marginBottom: 12 }}>
              Runs one full Solana pass for every account with a saved receive address (same job as the background
              worker). You can trigger it manually even when <span className="mono">SOLVEQUEST_DEPOSIT_SCAN</span> is off.
            </p>
            <button
              type="button"
              style={{ ...uiBtnPrimary, opacity: depositScanBusy ? 0.75 : 1 }}
              disabled={depositScanBusy || loading}
              onClick={() => void runDepositScan()}
            >
              {depositScanBusy ? "Scanning…" : "Run USDC deposit scanner"}
            </button>
            {depositScanErr ? (
              <p role="alert" style={{ color: "var(--danger)", marginTop: 10, fontSize: 13 }}>
                {depositScanErr}
              </p>
            ) : null}
            {depositScanOk ? (
              <p style={{ color: "var(--ok)", marginTop: 10, fontSize: 13 }}>{depositScanOk}</p>
            ) : null}
            {depositScanOk && depositScanReports && depositScanReports.length === 0 ? (
              <p style={{ color: "var(--muted)", marginTop: 12, fontSize: 13 }}>
                No accounts have a stored Solana receive address — nothing to scan.
              </p>
            ) : null}
            {depositScanReports && depositScanReports.length > 0 ? (
              <div
                style={s.scanReportWrap}
                className="app-table-scroll"
                aria-label="Deposit scan process log"
              >
                {depositScanReports.map((rep) => (
                  <div key={rep.account_id} style={s.scanReportCard}>
                    <div style={s.scanReportHead}>
                      <span className="mono" style={{ fontSize: 12, wordBreak: "break-all" }}>
                        {rep.account_id}
                      </span>
                      <span
                        style={{
                          ...s.scanStatusBadge,
                          color: scanStatusColor(rep.status),
                          borderColor: scanStatusColor(rep.status),
                        }}
                      >
                        {rep.status === "ok" ? "OK" : rep.status === "skipped" ? "Skipped" : "Error"}
                      </span>
                    </div>
                    <a
                      href={solscanAccountUrl(rep.sol_receive_address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mono"
                      style={{ fontSize: 11, display: "block", marginBottom: 8, wordBreak: "break-all" }}
                    >
                      {rep.sol_receive_address}
                    </a>
                    {rep.error ? (
                      <p style={{ color: "var(--danger)", fontSize: 12, margin: "0 0 8px" }}>{rep.error}</p>
                    ) : null}
                    <ul style={s.scanReportList}>
                      {rep.lines.map((line, i) => (
                        <li key={i} className="mono" style={s.scanReportLi}>
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section style={s.section}>
            <h2 className="app-section-title" style={s.h2}>
              Solana balances
            </h2>
            <div style={s.addrGrid}>
              <AddressCard title="Treasury (SOLANA_TREASURY_ADDRESS)" b={data.treasury} />
              <AddressCard title="Buy USDC receive (SWAP_USDC_RECEIVE_ADDRESS)" b={data.receive_address} />
            </div>
          </section>

          <section style={s.section}>
            <h2 className="app-section-title" style={s.h2}>
              QUSD → USDC swaps (ledger)
            </h2>
            <div className="app-table-scroll">
              <table className="data-table" style={{ width: "100%", minWidth: 640, fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Account</th>
                    <th>Swap ID</th>
                    <th>QUSD debited</th>
                    <th title="Using current SWAP_QUSD_USDC_RATE from env">Est. USDC</th>
                  </tr>
                </thead>
                <tbody>
                  {(swaps?.rows ?? []).map((row) => {
                    const est =
                      rateOk && row.qusd_debited > 0 ? row.qusd_debited / rateParsed : null;
                    return (
                      <tr key={row.id}>
                        <td className="mono">{fmtTs(row.created_at)}</td>
                        <td style={{ wordBreak: "break-all" }}>{row.account_email ?? row.account_id}</td>
                        <td className="mono" style={{ wordBreak: "break-all" }}>
                          {row.swap_id}
                        </td>
                        <td className="mono">{row.qusd_debited.toFixed(4)}</td>
                        <td className="mono">{est != null ? est.toFixed(6) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {swaps && swaps.total === 0 ? (
              <p style={{ color: "var(--muted)", marginTop: 8 }}>No swap debits recorded.</p>
            ) : null}
            {swaps && swaps.total > 0 ? (
              <Pager
                page={swaps.page}
                totalPages={swapTotalPages}
                total={swaps.total}
                loading={loading}
                onPrev={() =>
                  void load(Math.max(1, swaps.page - 1), data.swap_errors.page)
                }
                onNext={() =>
                  void load(Math.min(swapTotalPages, swaps.page + 1), data.swap_errors.page)
                }
              />
            ) : null}
          </section>

          <section style={s.section}>
            <h2 className="app-section-title" style={s.h2}>
              Swap errors (refunds after failed USDC send)
            </h2>
            <div className="app-table-scroll">
              <table className="data-table" style={{ width: "100%", minWidth: 640, fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Account</th>
                    <th>Swap ID</th>
                    <th>QUSD refunded</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {(errs?.rows ?? []).map((row) => (
                    <tr key={row.id}>
                      <td className="mono">{fmtTs(row.created_at)}</td>
                      <td style={{ wordBreak: "break-all" }}>{row.account_email ?? row.account_id}</td>
                      <td className="mono" style={{ wordBreak: "break-all" }}>
                        {row.swap_id}
                      </td>
                      <td className="mono">{row.qusd_refunded.toFixed(4)}</td>
                      <td style={{ wordBreak: "break-word", maxWidth: 280 }}>{row.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {errs && errs.total === 0 ? (
              <p style={{ color: "var(--muted)", marginTop: 8 }}>No refund rows (no failed sends recorded).</p>
            ) : null}
            {errs && errs.total > 0 ? (
              <Pager
                page={errs.page}
                totalPages={errTotalPages}
                total={errs.total}
                loading={loading}
                onPrev={() =>
                  void load(data.swaps.page, Math.max(1, errs.page - 1))
                }
                onNext={() =>
                  void load(data.swaps.page, Math.min(errTotalPages, errs.page + 1))
                }
              />
            ) : null}
          </section>

          <section style={s.section}>
            <h2 className="app-section-title" style={s.h2}>
              Environment (server)
            </h2>
            <div className="app-table-scroll">
              <table className="data-table" style={{ width: "100%", minWidth: 480, fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>Variable</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {envRows.map(([k, v]) => (
                    <tr key={k}>
                      <td className="mono" style={{ whiteSpace: "nowrap" }}>
                        {k}
                      </td>
                      <td className="mono" style={{ wordBreak: "break-all" }}>
                        {v || <span style={{ color: "var(--muted)" }}>(unset)</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function AddressCard({ title, b }: { title: string; b: AddrBalance }) {
  const addr = b.address;
  return (
    <div style={s.card}>
      <div style={s.cardTitle}>{title}</div>
      {!addr ? (
        <p style={{ color: "var(--muted)", margin: 0, fontSize: 13 }}>No address configured.</p>
      ) : (
        <>
          <a
            href={solscanAccountUrl(addr)}
            target="_blank"
            rel="noopener noreferrer"
            className="mono"
            style={{ fontSize: 13, wordBreak: "break-all", display: "inline-block", marginBottom: 8 }}
          >
            {addr}
          </a>
          {b.error ? (
            <p style={{ color: "var(--danger)", fontSize: 12, margin: "4px 0 0" }}>{b.error}</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              <li>
                USDC (ATA):{" "}
                <span className="mono">{b.usdc_ui != null ? b.usdc_ui.toFixed(6) : "—"}</span>
              </li>
              <li>
                SOL: <span className="mono">{fmtSol(b.sol_lamports)}</span>
              </li>
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Pager({
  page,
  totalPages,
  total,
  loading,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  total: number;
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div style={s.pager}>
      <span style={{ color: "var(--muted)", fontSize: 13 }}>
        Page {page} of {totalPages} · {total} total
      </span>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          style={{ ...uiBtnGhost, opacity: page <= 1 ? 0.45 : 1 }}
          disabled={page <= 1 || loading}
          onClick={onPrev}
        >
          Previous
        </button>
        <button
          type="button"
          style={{ ...uiBtnGhost, opacity: page >= totalPages ? 0.45 : 1 }}
          disabled={page >= totalPages || loading}
          onClick={onNext}
        >
          Next
        </button>
      </div>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  wrap: { maxWidth: 960, margin: "0 auto" },
  section: { marginBottom: 28 },
  h2: { fontSize: 16, marginBottom: 12 },
  mutedP: { margin: 0, fontSize: 13, lineHeight: 1.55, color: "var(--muted)", maxWidth: 560 },
  scanReportWrap: {
    marginTop: 16,
    maxHeight: 420,
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: "2px 0",
  },
  scanReportCard: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 10,
    background: "color-mix(in srgb, var(--text) 4%, var(--panel))",
  },
  scanReportHead: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 6,
  },
  scanStatusBadge: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    padding: "2px 8px",
    borderRadius: 4,
    border: "1px solid",
    flexShrink: 0,
  },
  scanReportList: {
    margin: 0,
    paddingLeft: 18,
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--muted)",
  },
  scanReportLi: { marginBottom: 4 },
  addrGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: 16,
  },
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 12,
    background: "var(--surface-elevated, rgba(255,255,255,0.03))",
  },
  cardTitle: { fontSize: 12, color: "var(--muted)", marginBottom: 8 },
  pager: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 16,
  },
};
