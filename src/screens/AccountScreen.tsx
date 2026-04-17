import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useSessionAuth } from "../auth/sessionAuth";
import { uiBtnGhost, uiBtnPrimary, uiFieldLabel, uiInput } from "../ui/appSurface";
import { QusdAmount } from "../Qusd";

const LINK_VERIFY_BONUS_QUSD = 10_000;

const SWAP_HISTORY_PAGE_SIZE = 15;
const DEPOSIT_HISTORY_PAGE_SIZE = 15;

const SOLSCAN_TX = "https://solscan.io/tx";

type DepositHistoryRow = {
  id: number;
  credited_at: number;
  usdc_amount: number;
  qusd_credited: number;
  signature: string;
};

type SwapHistoryRow = {
  id: number;
  created_at: number;
  kind: "swap" | "refund";
  swap_id: string;
  qusd_amount: number;
  estimated_usdc: number | null;
};

function fmtSwapTs(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Stat value text was 2rem; reduced by 40% → 60% scale. */
const STAT_VALUE_FS = "1.2rem";
const STAT_ICON_LG = 14;
const statAmountStyle = {
  fontSize: STAT_VALUE_FS,
  fontWeight: 700,
  letterSpacing: "-0.02em",
} as const;

type Props = {
  /** Server-assigned leaderboard handle; null until assigned after email verification. */
  coolUsername?: string | null;
  /** Anonymous demo: no Solana deposit UI; balances stay in-browser only. */
  isDemo?: boolean;
  /** After verification, the user’s Solana address used for USDC deposit scan. */
  serverDepositAddress?: string | null;
  /** True once on-chain verification succeeded (address cannot be changed). */
  solReceiveVerified?: boolean;
  /** Shown when GET /api/account/me failed. */
  depositAddressError?: string | null;
  qusdUnlocked: number;
  onRefreshAccount?: () => void | Promise<void>;
};

export default function AccountScreen({
  coolUsername = null,
  isDemo = false,
  serverDepositAddress = null,
  solReceiveVerified = false,
  depositAddressError = null,
  qusdUnlocked,
  onRefreshAccount,
}: Props) {
  const { authLoading, user, refreshUser } = useSessionAuth();
  const [draftAddress, setDraftAddress] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [swapPage, setSwapPage] = useState(1);
  const [swapTotal, setSwapTotal] = useState(0);
  const [swapRows, setSwapRows] = useState<SwapHistoryRow[]>([]);
  const [swapLoading, setSwapLoading] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [depositPage, setDepositPage] = useState(1);
  const [depositTotal, setDepositTotal] = useState(0);
  const [depositRows, setDepositRows] = useState<DepositHistoryRow[]>([]);
  const [depositLoading, setDepositLoading] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);
  const verified = Boolean(solReceiveVerified);
  const displayAddr = serverDepositAddress?.trim() ?? "";

  useEffect(() => {
    if (verified && displayAddr) setDraftAddress(displayAddr);
  }, [verified, displayAddr]);

  const loadDepositHistory = useCallback(
    async (p: number) => {
      if (isDemo || authLoading || !user) {
        setDepositLoading(false);
        return;
      }
      setDepositLoading(true);
      setDepositError(null);
      try {
        let r = await fetch(
          `/api/account/usdc-deposit-history?page=${p}&page_size=${DEPOSIT_HISTORY_PAGE_SIZE}`,
          { credentials: "include" },
        );
        if (r.status === 401) {
          await refreshUser();
          r = await fetch(
            `/api/account/usdc-deposit-history?page=${p}&page_size=${DEPOSIT_HISTORY_PAGE_SIZE}`,
            { credentials: "include" },
          );
        }
        if (!r.ok) {
          setDepositError(
            r.status === 401 ? "Sign in to see deposit history." : "Could not load USDC deposit history.",
          );
          setDepositRows([]);
          setDepositTotal(0);
          return;
        }
        const data = (await r.json()) as {
          rows?: DepositHistoryRow[];
          total?: number;
          page?: number;
        };
        setDepositRows(data.rows ?? []);
        setDepositTotal(Number(data.total) || 0);
        setDepositPage(Number(data.page) || p);
      } catch {
        setDepositError("Network error.");
        setDepositRows([]);
        setDepositTotal(0);
      } finally {
        setDepositLoading(false);
      }
    },
    [isDemo, authLoading, user, refreshUser],
  );

  const submitVerify = useCallback(async () => {
    const addr = draftAddress.trim();
    if (!addr || verifyBusy || verified) return;
    setVerifyBusy(true);
    setVerifyError(null);
    try {
      const r = await fetch("/api/account/verify-solana-address", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        min_lamports?: number;
        lamports?: number;
      };
      if (!r.ok) {
        const msg = j.message || j.error || `Verification failed (${r.status})`;
        setVerifyError(msg);
        return;
      }
      await onRefreshAccount?.();
      void loadDepositHistory(1);
    } catch (e) {
      setVerifyError(e instanceof Error ? e.message : "Network error");
    } finally {
      setVerifyBusy(false);
    }
  }, [draftAddress, verifyBusy, verified, onRefreshAccount, loadDepositHistory]);

  const loadSwapHistory = useCallback(
    async (p: number) => {
      if (isDemo || authLoading || !user) {
        setSwapLoading(false);
        return;
      }
      setSwapLoading(true);
      setSwapError(null);
      try {
        let r = await fetch(
          `/api/account/swap-history?page=${p}&page_size=${SWAP_HISTORY_PAGE_SIZE}`,
          { credentials: "include" },
        );
        if (r.status === 401) {
          await refreshUser();
          r = await fetch(
            `/api/account/swap-history?page=${p}&page_size=${SWAP_HISTORY_PAGE_SIZE}`,
            { credentials: "include" },
          );
        }
        if (!r.ok) {
          setSwapError(r.status === 401 ? "Sign in to see swap history." : "Could not load swap history.");
          setSwapRows([]);
          setSwapTotal(0);
          return;
        }
        const data = (await r.json()) as {
          rows?: SwapHistoryRow[];
          total?: number;
          page?: number;
        };
        setSwapRows(data.rows ?? []);
        setSwapTotal(Number(data.total) || 0);
        setSwapPage(Number(data.page) || p);
      } catch {
        setSwapError("Network error.");
        setSwapRows([]);
        setSwapTotal(0);
      } finally {
        setSwapLoading(false);
      }
    },
    [isDemo, authLoading, user, refreshUser],
  );

  useEffect(() => {
    if (isDemo) return;
    void loadSwapHistory(1);
  }, [isDemo, loadSwapHistory]);

  useEffect(() => {
    if (isDemo) return;
    void loadDepositHistory(1);
  }, [isDemo, loadDepositHistory]);

  const displayName = coolUsername?.trim() || "";

  return (
    <div className="app-page" style={s.wrap}>
      <div style={s.metricsStack}>
        {!isDemo ? (
          <section style={s.namePanel} aria-label="Leaderboard display name">
            <p style={s.statLabel}>Your leaderboard name</p>
            <p style={s.usernameMono} className="mono">
              {displayName || "—"}
            </p>
            <p style={{ ...s.statSub, marginTop: 8 }}>
              {displayName
                ? "This is how you appear on the leaderboard."
                : "You’ll get a unique name after email verification (refresh if you just signed in)."}
            </p>
          </section>
        ) : null}

        <div className="account-balance-grid">
          <section style={s.statHero} aria-label="QUSD balance">
            <p style={s.statLabel}>QUSD balance</p>
            <div style={s.statHeroValue}>
              <QusdAmount
                value={qusdUnlocked}
                maximumFractionDigits={2}
                strong
                color="var(--accent)"
                iconSize={STAT_ICON_LG}
                amountStyle={statAmountStyle}
              />
            </div>
            <p style={s.statSub}>Available for perpetual margin and withdrawals per product rules.</p>
          </section>
        </div>

        <section
          style={{ ...s.statHero, ...s.walletPanelTop }}
          aria-label="Solana address and USDC deposits"
        >
          <div style={s.buyMoreHeader}>
            <img
              src="/icon-sol.png"
              alt=""
              width={28}
              height={28}
              style={{ ...s.buyMoreIcon, objectFit: "contain" }}
            />
            <h2 style={s.buyMoreTitle}>Solana Address</h2>
          </div>

          {isDemo ? (
            <>
              <h3 style={s.walletExternalHeading}>External funds (after registration)</h3>
              <p style={s.walletExternalIntro}>
                You are in <strong style={{ color: "var(--text)" }}>demo mode</strong>: balances for this session
                stay in this browser only. After you register, you can link your own Solana wallet address on this
                page to receive the onboarding credit and deposit USDC.
              </p>
            </>
          ) : (
            <>
              <p style={s.depositExplainer}>
                You receive{" "}
                <strong style={{ color: "var(--text)" }}>{LINK_VERIFY_BONUS_QUSD.toLocaleString()} QUSD</strong> when you
                link and verify a <strong style={{ color: "var(--text)" }}>Solana mainnet</strong> address that has a
                small SOL balance. The linked address cannot be changed later.
              </p>

              {depositAddressError ? (
                <p style={s.err} role="alert">
                  {depositAddressError}
                </p>
              ) : null}

              <div style={s.verifyBlock}>
                <label htmlFor="sol-verify-address" style={s.verifyLabel}>
                  Your Solana Wallet Address
                </label>
                <input
                  id="sol-verify-address"
                  type="text"
                  name="solanaAddress"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="e.g. Your Phantom or Solflare public address"
                  value={verified ? displayAddr : draftAddress}
                  readOnly={verified}
                  disabled={verified}
                  onChange={(e) => setDraftAddress(e.target.value)}
                  style={{ ...uiInput, ...s.verifyInput, ...(verified ? s.verifyInputLocked : {}) }}
                />
                <button
                  type="button"
                  style={{ ...uiBtnPrimary, ...s.verifyBtn, ...(verifyBusy ? s.verifyBtnBusy : {}) }}
                  disabled={verified || verifyBusy || !draftAddress.trim()}
                  onClick={() => void submitVerify()}
                >
                  {verified ? "Verified" : verifyBusy ? "Checking…" : "Verify on-chain"}
                </button>
                {verifyError ? (
                  <p style={s.err} role="alert">
                    {verifyError}
                  </p>
                ) : null}
              </div>
            </>
          )}
        </section>

        {!isDemo ? (
          <section style={{ ...s.statHero, ...s.swapHistoryPanel }} aria-label="USDC to QUSD deposit history">
            <div style={s.buyMoreHeader}>
              <img
                src="/icon-sol.png"
                alt=""
                width={28}
                height={28}
                style={{ ...s.buyMoreIcon, objectFit: "contain" }}
              />
              <h2 style={s.buyMoreTitle}>USDC → QUSD deposits</h2>
            </div>
            <p style={{ ...s.statSub, marginBottom: 12 }}>
              On-chain USDC sent to your deposit address, credited as QUSD at the current rate.
            </p>
            {depositError ? (
              <p style={s.err} role="alert">
                {depositError}
              </p>
            ) : null}
            {depositLoading && depositRows.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</p>
            ) : (
              <div className="app-table-scroll">
                <table className="data-table" style={{ width: "100%", minWidth: 480, fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>USDC</th>
                      <th>QUSD credited</th>
                      <th>Transaction</th>
                    </tr>
                  </thead>
                  <tbody>
                    {depositRows.map((row) => (
                      <tr key={row.id}>
                        <td className="mono" style={{ whiteSpace: "nowrap" }}>
                          {fmtSwapTs(row.credited_at)}
                        </td>
                        <td className="mono">{row.usdc_amount.toFixed(6)}</td>
                        <td className="mono">{row.qusd_credited.toFixed(2)}</td>
                        <td>
                          <a
                            href={`${SOLSCAN_TX}/${encodeURIComponent(row.signature)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mono"
                            style={s.depositTxLink}
                          >
                            Solscan
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {depositRows.length === 0 && !depositLoading && !depositError ? (
              <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>No USDC deposits yet.</p>
            ) : null}
            {depositTotal > 0 ? (
              <div style={s.swapPager}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>
                  Page {depositPage} of {Math.max(1, Math.ceil(depositTotal / DEPOSIT_HISTORY_PAGE_SIZE))} ·{" "}
                  {depositTotal} total
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    style={{ ...uiBtnGhost, opacity: depositPage <= 1 ? 0.45 : 1 }}
                    disabled={depositPage <= 1 || depositLoading}
                    onClick={() => void loadDepositHistory(Math.max(1, depositPage - 1))}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    style={{
                      ...uiBtnGhost,
                      opacity: depositPage >= Math.ceil(depositTotal / DEPOSIT_HISTORY_PAGE_SIZE) ? 0.45 : 1,
                    }}
                    disabled={
                      depositPage >= Math.ceil(depositTotal / DEPOSIT_HISTORY_PAGE_SIZE) || depositLoading
                    }
                    onClick={() => void loadDepositHistory(depositPage + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {!isDemo ? (
          <section style={{ ...s.statHero, ...s.swapHistoryPanel }} aria-label="QUSD to USDC swap history">
            <div style={s.buyMoreHeader}>
              <img
                src="/icon-sol.png"
                alt=""
                width={28}
                height={28}
                style={{ ...s.buyMoreIcon, objectFit: "contain" }}
              />
              <h2 style={s.buyMoreTitle}>Swap history</h2>
            </div>
            <p style={{ ...s.statSub, marginBottom: 12 }}>
              QUSD→USDC swaps from the Swap page. Refunds appear if an on-chain USDC send failed after your QUSD was
              debited.
            </p>
            {swapError ? (
              <p style={s.err} role="alert">
                {swapError}
              </p>
            ) : null}
            {swapLoading && swapRows.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</p>
            ) : (
              <div className="app-table-scroll">
                <table className="data-table" style={{ width: "100%", minWidth: 420, fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Type</th>
                      <th>QUSD</th>
                      <th>Est. USDC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {swapRows.map((row) => (
                      <tr key={`${row.kind}-${row.id}`}>
                        <td className="mono" style={{ whiteSpace: "nowrap" }}>
                          {fmtSwapTs(row.created_at)}
                        </td>
                        <td>{row.kind === "refund" ? "Refund" : "Swap"}</td>
                        <td className="mono">{row.qusd_amount.toFixed(2)}</td>
                        <td className="mono">
                          {row.estimated_usdc != null ? row.estimated_usdc.toFixed(6) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {swapRows.length === 0 && !swapLoading && !swapError ? (
              <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>No swaps yet.</p>
            ) : null}
            {swapTotal > 0 ? (
              <div style={s.swapPager}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>
                  Page {swapPage} of {Math.max(1, Math.ceil(swapTotal / SWAP_HISTORY_PAGE_SIZE))} · {swapTotal} total
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    style={{ ...uiBtnGhost, opacity: swapPage <= 1 ? 0.45 : 1 }}
                    disabled={swapPage <= 1 || swapLoading}
                    onClick={() => void loadSwapHistory(Math.max(1, swapPage - 1))}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    style={{
                      ...uiBtnGhost,
                      opacity: swapPage >= Math.ceil(swapTotal / SWAP_HISTORY_PAGE_SIZE) ? 0.45 : 1,
                    }}
                    disabled={swapPage >= Math.ceil(swapTotal / SWAP_HISTORY_PAGE_SIZE) || swapLoading}
                    onClick={() => void loadSwapHistory(swapPage + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  wrap: { display: "flex", flexDirection: "column", gap: 16 },
  metricsStack: { display: "flex", flexDirection: "column", gap: 16 },
  namePanel: {
    width: "100%",
    padding: "14px 16px",
    borderRadius: 12,
    border: "1px solid color-mix(in srgb, var(--border) 90%, var(--text))",
    background: "var(--panel)",
  },
  usernameMono: {
    margin: "6px 0 0",
    fontSize: "1.05rem",
    fontWeight: 650,
    letterSpacing: "-0.02em",
    color: "color-mix(in srgb, var(--accent) 85%, var(--text))",
    wordBreak: "break-word",
  },
  err: { margin: "8px 0 0", fontSize: 13, color: "var(--danger)" },
  buyMoreHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  buyMoreIcon: { flexShrink: 0 },
  buyMoreTitle: {
    margin: 0,
    fontSize: "1.15rem",
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: "var(--text)",
  },
  walletPanelTop: {
    width: "100%",
    background:
      "linear-gradient(135deg, color-mix(in srgb, var(--accent) 14%, var(--panel)) 0%, var(--surface) 100%)",
    border: "1px solid color-mix(in srgb, var(--accent) 32%, var(--border))",
    boxShadow:
      "inset 0 1px 0 color-mix(in srgb, var(--text) 5%, transparent), 0 6px 28px color-mix(in srgb, var(--accent) 8%, transparent)",
  },
  depositExplainer: {
    margin: "0 0 12px",
    padding: "12px 14px",
    fontSize: 13,
    lineHeight: 1.55,
    color: "var(--muted)",
    borderRadius: 8,
    border: "1px solid color-mix(in srgb, var(--accent) 24%, var(--border))",
    background: "color-mix(in srgb, var(--accent) 6%, var(--bg))",
  },
  verifyBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    marginTop: 4,
  },
  verifyLabel: {
    ...uiFieldLabel,
    margin: 0,
  },
  verifyInput: {
    width: "100%",
    boxSizing: "border-box",
  },
  verifyInputLocked: {
    opacity: 0.92,
    cursor: "not-allowed",
    background: "color-mix(in srgb, var(--muted) 8%, var(--bg))",
  },
  verifyBtn: {
    alignSelf: "flex-start",
    marginTop: 2,
  },
  verifyBtnBusy: { opacity: 0.75 },
  walletExternalHeading: {
    margin: "16px 0 10px",
    fontSize: "1rem",
    fontWeight: 600,
    color: "var(--muted)",
  },
  walletExternalIntro: {
    margin: "0 0 0",
    fontSize: 13,
    lineHeight: 1.55,
    color: "var(--muted)",
  },
  statHero: {
    background: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, var(--panel)) 0%, var(--surface) 100%)",
    border: "1px solid color-mix(in srgb, var(--accent) 28%, var(--border))",
    borderRadius: 12,
    padding: "22px 20px",
    boxShadow:
      "inset 0 1px 0 color-mix(in srgb, var(--text) 5%, transparent), 0 4px 24px color-mix(in srgb, var(--text) 5%, transparent)",
  },
  statLabel: {
    margin: "0 0 8px",
    ...uiFieldLabel,
  },
  statHeroValue: {
    margin: "0 0 8px",
    minHeight: "1.5rem",
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 4,
  },
  statSub: { margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--muted)" },
  inlineCodeEnv: {
    fontSize: "0.85em",
    fontWeight: 600,
    color: "var(--muted)",
  },
  swapHistoryPanel: {
    width: "100%",
  },
  /** Solscan tx link — `var(--ok)` so it matches app success green, not default link blue/purple */
  depositTxLink: {
    fontSize: 12,
    color: "var(--ok)",
    textDecorationColor: "color-mix(in srgb, var(--ok) 45%, transparent)",
  },
  swapPager: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 16,
  },
};
