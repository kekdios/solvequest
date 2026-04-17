import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { uiBtnPrimary, uiInput } from "../ui/appSurface";
import { QUSD_PER_USD } from "../engine/qusdVault";
import { QusdIcon } from "../Qusd";
import { computeSwapAmounts } from "../lib/swapAmounts";
import { friendlyQusdToUsdcSwapError } from "../lib/swapFriendlyMessages";

const TestReceiveAddresses = lazy(() => import("../components/TestReceiveAddresses"));

const CHANGENOW_URL = "https://changenow.io/";
const USDC_ICON = "/prize-usdc.png";

type SwapConfig = {
  swap_above_amount: number;
  swap_qusd_usdc_rate: number;
  swap_maximum_usdc_amount: number;
  swap_enabled: boolean;
};

type DepositScanHealth = {
  worker_enabled: boolean;
  interval_ms: number;
  last_tick_at: number | null;
  status: "disabled" | "starting" | "ok" | "stale";
};

type Preflight = {
  swap_above_amount: number;
  swap_qusd_usdc_rate: number;
  swap_maximum_usdc_amount: number;
  qusd_unlocked: number;
  sol_receive_verified: boolean;
  sol_receive_address: string | null;
  treasury_usdc: number;
  treasury_sol_lamports: number;
  treasury_ready: boolean;
  min_treasury_sol_lamports: number;
};

type Props = {
  isDemo: boolean;
  qusdUnlocked: number;
  solReceiveVerified: boolean;
  /** User’s verified Solana receive address (USDC deposit scan). */
  serverDepositAddress?: string | null;
  onRefreshAccount?: () => void | Promise<void>;
  onGoToAccount?: () => void;
};

const card: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "18px 20px",
  marginTop: 8,
  maxWidth: 520,
  background: "var(--panel)",
};

const dep: Record<string, CSSProperties> = {
  panel: {
    width: "100%",
    maxWidth: 520,
    marginTop: 8,
    background:
      "linear-gradient(135deg, color-mix(in srgb, var(--accent) 12%, var(--panel)) 0%, var(--surface) 100%)",
    border: "1px solid color-mix(in srgb, var(--accent) 28%, var(--border))",
    borderRadius: 12,
    padding: "20px 20px 22px",
    boxShadow:
      "inset 0 1px 0 color-mix(in srgb, var(--text) 5%, transparent), 0 4px 24px color-mix(in srgb, var(--text) 5%, transparent)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  title: {
    margin: 0,
    fontSize: "1.15rem",
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: "var(--text)",
  },
  lead: {
    margin: "0 0 14px",
    padding: "12px 14px",
    fontSize: 13,
    lineHeight: 1.55,
    color: "var(--muted)",
    borderRadius: 8,
    border: "1px solid color-mix(in srgb, var(--accent) 22%, var(--border))",
    background: "color-mix(in srgb, var(--accent) 5%, var(--bg))",
  },
  hintStrong: {
    color: "color-mix(in srgb, var(--accent) 92%, #fff)",
    fontWeight: 700,
  },
  addressBlock: { marginTop: 8 },
  suspenseFallback: { fontSize: 13, color: "var(--muted)" },
  changeNow: {
    margin: "12px 0 0",
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text)",
  },
  changeNowLink: { color: "var(--accent)", fontWeight: 600 },
  /** Matches QUSD→USDC summary bullets: muted body copy. */
  summaryList: {
    margin: 0,
    paddingLeft: 18,
    color: "var(--muted)",
    fontSize: 13,
    lineHeight: 1.55,
    maxWidth: 520,
  },
  summaryListTightBottom: {
    margin: "0 0 12px",
    paddingLeft: 18,
    color: "var(--muted)",
    fontSize: 13,
    lineHeight: 1.55,
    maxWidth: 520,
  },
  summaryListLi: { marginBottom: 8 },
  summaryFollowText: {
    margin: "8px 0 0",
    padding: 0,
    color: "var(--muted)",
    fontSize: 13,
    lineHeight: 1.55,
    maxWidth: 520,
  },
  summaryDirection: {
    margin: "0 0 8px",
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    color: "var(--text)",
  },
  summaryDirectionSpaced: {
    margin: "18px 0 8px",
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    color: "var(--text)",
  },
  swapProgress: {
    marginTop: 16,
    padding: "14px 16px",
    borderRadius: 10,
    border: "1px solid color-mix(in srgb, var(--accent) 22%, var(--border))",
    background: "color-mix(in srgb, var(--accent) 5%, var(--panel))",
  },
  swapProgressTitle: {
    margin: "0 0 10px",
    fontSize: 12,
    fontWeight: 650,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
    color: "var(--muted)",
  },
  swapProgressRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 10,
    fontSize: 13,
    lineHeight: 1.45,
  },
  swapProgressRowLast: { marginBottom: 0 },
  swapDot: {
    flexShrink: 0,
    width: 22,
    height: 22,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 11,
    fontWeight: 700,
  },
  healthLine: {
    margin: "12px 0 0",
    padding: "10px 12px",
    fontSize: 12,
    lineHeight: 1.45,
    borderRadius: 8,
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
  },
  healthDot: {
    flexShrink: 0,
    marginTop: 3,
    width: 8,
    height: 8,
    borderRadius: "50%",
  },
};

function formatShortAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function SwapProgressRow({
  phase,
  step,
  label,
  isLast,
}: {
  phase: number;
  step: number;
  label: string;
  isLast: boolean;
}) {
  const done = phase > step;
  const active = phase === step;
  return (
    <div style={{ ...dep.swapProgressRow, ...(isLast ? dep.swapProgressRowLast : {}) }}>
      <span
        style={{
          ...dep.swapDot,
          background: done
            ? "color-mix(in srgb, var(--ok) 28%, transparent)"
            : active
              ? "color-mix(in srgb, var(--accent) 30%, transparent)"
              : "color-mix(in srgb, var(--muted) 10%, transparent)",
          color: done ? "var(--ok)" : active ? "var(--accent)" : "var(--muted)",
          border: `1px solid ${
            done ? "color-mix(in srgb, var(--ok) 65%, transparent)" : active ? "var(--accent)" : "var(--border)"
          }`,
        }}
        aria-hidden
      >
        {done ? "✓" : step}
      </span>
      <span style={{ color: active ? "var(--text)" : "var(--muted)", fontWeight: active ? 600 : 400 }}>{label}</span>
    </div>
  );
}

export default function SwapScreen({
  isDemo,
  qusdUnlocked,
  solReceiveVerified,
  serverDepositAddress = null,
  onRefreshAccount,
  onGoToAccount,
}: Props) {
  const [cfg, setCfg] = useState<SwapConfig | null>(null);
  const [pf, setPf] = useState<Preflight | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  /** When set (`SWAP_USDC_RECEIVE_ADDRESS`), deposit UI shows this address instead of the user wallet. */
  const [buyDepositOverride, setBuyDepositOverride] = useState<string | null>(null);
  /** Server polls chain for USDC→QUSD only when `SOLVEQUEST_DEPOSIT_SCAN` is enabled. */
  const [autoCreditUsdcEnabled, setAutoCreditUsdcEnabled] = useState<boolean | null>(null);
  const [depositScanHealth, setDepositScanHealth] = useState<DepositScanHealth | null>(null);
  /** Bumps every 10s so “Xs ago” stays fresh without polling every second. */
  const [healthAgeTick, setHealthAgeTick] = useState(0);
  /** 0 idle; 1–3 which sub-step is highlighted during QUSD→USDC POST. */
  const [swapProgressPhase, setSwapProgressPhase] = useState(0);
  const displayAddr = serverDepositAddress?.trim() ?? "";

  useEffect(() => {
    if (isDemo) return;
    void fetch("/api/config/buy-qusd-deposit", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const a = j && typeof j === "object" && typeof (j as { address?: string }).address === "string"
          ? (j as { address: string }).address.trim()
          : "";
        setBuyDepositOverride(a || null);
        const acRaw =
          j && typeof j === "object" ? (j as Record<string, unknown>).auto_credit_usdc_enabled : undefined;
        setAutoCreditUsdcEnabled(typeof acRaw === "boolean" ? acRaw : null);
      })
      .catch(() => {
        setBuyDepositOverride(null);
        setAutoCreditUsdcEnabled(null);
      });
  }, [isDemo]);

  const loadDepositScanHealth = useCallback(async () => {
    if (isDemo) return;
    try {
      const r = await fetch("/api/config/deposit-scan-health", { credentials: "same-origin" });
      if (!r.ok) {
        setDepositScanHealth(null);
        return;
      }
      const j = (await r.json()) as unknown;
      if (!j || typeof j !== "object") {
        setDepositScanHealth(null);
        return;
      }
      const o = j as Record<string, unknown>;
      if (
        typeof o.worker_enabled !== "boolean" ||
        typeof o.interval_ms !== "number" ||
        (o.last_tick_at != null && typeof o.last_tick_at !== "number") ||
        typeof o.status !== "string"
      ) {
        setDepositScanHealth(null);
        return;
      }
      const st = o.status;
      if (st !== "disabled" && st !== "starting" && st !== "ok" && st !== "stale") {
        setDepositScanHealth(null);
        return;
      }
      setDepositScanHealth({
        worker_enabled: o.worker_enabled,
        interval_ms: o.interval_ms,
        last_tick_at: o.last_tick_at == null ? null : Number(o.last_tick_at),
        status: st,
      });
    } catch {
      setDepositScanHealth(null);
    }
  }, [isDemo]);

  useEffect(() => {
    if (isDemo) return;
    void loadDepositScanHealth();
    const id = window.setInterval(() => void loadDepositScanHealth(), 20_000);
    return () => clearInterval(id);
  }, [isDemo, loadDepositScanHealth]);

  useEffect(() => {
    if (isDemo) return;
    const id = window.setInterval(() => setHealthAgeTick((x) => x + 1), 10_000);
    return () => clearInterval(id);
  }, [isDemo]);

  useEffect(() => {
    void fetch("/api/swap/config", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j && typeof j === "object") setCfg(j as SwapConfig);
      })
      .catch(() => setCfg(null));
  }, []);

  const loadPreflight = useCallback(() => {
    if (isDemo) {
      setPf(null);
      return;
    }
    void fetch("/api/swap/preflight", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j && typeof j === "object") setPf(j as Preflight);
        else setPf(null);
      })
      .catch(() => setPf(null));
  }, [isDemo]);

  useEffect(() => {
    loadPreflight();
  }, [loadPreflight, qusdUnlocked, solReceiveVerified]);

  const qIn = Number.parseFloat(draft.replace(/,/g, ""));
  const rate = cfg?.swap_qusd_usdc_rate ?? 0;
  const maxU = cfg?.swap_maximum_usdc_amount ?? 0;
  const minAbove = cfg?.swap_above_amount ?? 0;
  const treasuryU = pf?.treasury_usdc ?? 0;

  const { qusdDebit, usdcOut } = useMemo(() => {
    if (!Number.isFinite(qIn) || qIn <= 0) return { qusdDebit: 0, usdcOut: 0 };
    return computeSwapAmounts(qIn, rate, maxU, treasuryU);
  }, [qIn, rate, maxU, treasuryU]);

  /** Uncapped USDC if full balance above minimum were swappable: (balance − SWAP_ABOVE_AMOUNT) ÷ rate. */
  const hypotheticalFullBalanceUsdc = useMemo(() => {
    if (!(rate > 0)) return null;
    if (!Number.isFinite(qusdUnlocked) || !Number.isFinite(minAbove)) return null;
    const b = qusdUnlocked - minAbove;
    if (!Number.isFinite(b)) return null;
    const raw = Math.max(0, b) / rate;
    return Math.round(raw * 100) / 100;
  }, [qusdUnlocked, minAbove, rate]);

  const canSubmit =
    !isDemo &&
    !busy &&
    cfg?.swap_enabled &&
    pf?.treasury_ready &&
    solReceiveVerified &&
    Number.isFinite(qIn) &&
    qIn > minAbove &&
    qIn <= qusdUnlocked + 1e-9 &&
    usdcOut > 0 &&
    qusdDebit > 0 &&
    qusdDebit <= qusdUnlocked + 1e-9;

  useEffect(() => {
    if (!busy) {
      setSwapProgressPhase(0);
      return;
    }
    setSwapProgressPhase(1);
    const t2 = window.setTimeout(() => setSwapProgressPhase(2), 450);
    const t3 = window.setTimeout(() => setSwapProgressPhase(3), 950);
    return () => {
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [busy]);

  const submit = useCallback(async () => {
    if (!canSubmit || !Number.isFinite(qIn)) return;
    setBusy(true);
    setErr(null);
    setOkMsg(null);
    try {
      const r = await fetch("/api/swap", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qusd_amount: qIn }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        signature?: string;
        qusd_debited?: number;
        usdc_sent?: number;
      };
      if (!r.ok) {
        setErr(friendlyQusdToUsdcSwapError(j, r.status));
        return;
      }
      const usdc = j.usdc_sent != null ? j.usdc_sent.toFixed(2) : "";
      const sigShort = j.signature ? `${j.signature.slice(0, 8)}…` : "";
      setOkMsg(
        `Success — about ${usdc} USDC is on its way to your wallet. Your QUSD balance was updated.${sigShort ? ` Reference: ${sigShort}` : ""}`,
      );
      setDraft("");
      await onRefreshAccount?.();
      loadPreflight();
    } catch {
      setErr("We couldn’t reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, [canSubmit, qIn, onRefreshAccount, loadPreflight]);

  const depositHealthLabel = useMemo(() => {
    void healthAgeTick;
    const h = depositScanHealth;
    if (!h) return null;
    const borderMix = "color-mix(in srgb, var(--border) 85%, transparent)";
    const base = { border: borderMix, bg: "color-mix(in srgb, var(--muted) 5%, var(--panel))" };
    switch (h.status) {
      case "disabled":
        return {
          ...base,
          dot: "var(--muted)",
          text: "USDC deposit scanner is off on this server (deposits won’t credit automatically).",
        };
      case "starting":
        return {
          ...base,
          dot: "var(--warn)",
          bg: "color-mix(in srgb, var(--warn) 8%, var(--panel))",
          text: "USDC deposit scanner is starting — waiting for the first full blockchain check…",
        };
      case "ok": {
        const ago =
          h.last_tick_at != null ? formatShortAgo(Date.now() - h.last_tick_at) : "recently";
        return {
          ...base,
          dot: "var(--ok)",
          bg: "color-mix(in srgb, var(--ok) 7%, var(--panel))",
          text: `USDC deposit scanner is running. Last full pass ${ago}.`,
        };
      }
      case "stale":
        return {
          ...base,
          dot: "var(--danger)",
          bg: "color-mix(in srgb, var(--danger) 8%, var(--panel))",
          text: "USDC deposit scanner hasn’t completed a full pass recently. If credits are stuck, check server logs or support.",
        };
      default:
        return null;
    }
  }, [depositScanHealth, healthAgeTick]);

  if (isDemo) {
    return (
      <div style={card}>
        <p style={{ margin: 0, color: "var(--muted)" }}>
          Swap is available in the live app with a signed-in account and verified Solana address.
        </p>
      </div>
    );
  }

  return (
    <div className="app-page">
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <QusdIcon size={22} />
          <span style={{ fontSize: 14, color: "var(--muted)" }}>Your QUSD balance</span>
        </div>
        <p style={{ margin: 0, fontSize: "1.35rem", fontWeight: 700 }} className="mono">
          {qusdUnlocked.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </p>
      </div>

      {depositHealthLabel ? (
        <p
          style={{
            ...dep.healthLine,
            maxWidth: 520,
            border: `1px solid ${depositHealthLabel.border}`,
            background: depositHealthLabel.bg,
            color: "var(--text)",
          }}
          role="status"
          aria-live="polite"
        >
          <span style={{ ...dep.healthDot, background: depositHealthLabel.dot }} aria-hidden />
          <span>{depositHealthLabel.text}</span>
        </p>
      ) : null}

      {!isDemo && (buyDepositOverride || (solReceiveVerified && displayAddr)) ? (
        <section style={dep.panel} aria-label="Swap USDC to QUSD">
          <div style={dep.header}>
            <h2 style={dep.title}>Swap USDC to QUSD</h2>
          </div>
          <p style={dep.lead}>
            Send <strong style={{ color: "var(--text)" }}>USDC</strong> on Solana to{" "}
            <strong style={{ color: "var(--text)" }}>
              {buyDepositOverride ? "the deposit address" : "your verified address"}
            </strong>{" "}
            below. We add the QUSD (at{" "}
            <strong style={{ color: "var(--text)" }}>{QUSD_PER_USD} QUSD per $1 USDC</strong>) to your account after
            on-chain confirmation.
          </p>
          <div style={dep.addressBlock}>
            <Suspense fallback={<p style={dep.suspenseFallback}>Loading…</p>}>
              <TestReceiveAddresses
                serverDepositAddress={buyDepositOverride ?? displayAddr}
                depositAddressError={null}
                addressReady
                variant="user_deposit"
                depositHintOverride={
                  buyDepositOverride ? (
                    <>
                      Only send <strong style={dep.hintStrong}>USDC</strong> on the{" "}
                      <strong style={dep.hintStrong}>Solana Network</strong> to the deposit address.
                    </>
                  ) : (
                    <>
                      Only send <strong style={dep.hintStrong}>USDC</strong> on the{" "}
                      <strong style={dep.hintStrong}>Solana Network</strong> to this <strong>verified</strong> wallet —
                      your linked receive address for QUSD credits.
                    </>
                  )
                }
              />
            </Suspense>
          </div>
          <p style={dep.changeNow}>
            <a href={CHANGENOW_URL} target="_blank" rel="noopener noreferrer" style={dep.changeNowLink}>
              Buy/Sell cryptocurrencies
            </a>{" "}
            <span style={{ color: "var(--muted)" }}>— instant swaps via ChangeNOW.</span>
          </p>
        </section>
      ) : null}

      {!solReceiveVerified ? (
        <div style={card}>
          <p style={{ margin: 0, color: "var(--warn)" }}>
            Verify your Solana wallet on the <strong>Account</strong> page before swapping.
          </p>
          {onGoToAccount ? (
            <button type="button" style={{ ...uiBtnPrimary, marginTop: 12 }} onClick={onGoToAccount}>
              Go to Account
            </button>
          ) : null}
        </div>
      ) : null}

      <section style={dep.panel} aria-labelledby="swap-qusd-to-usdc-heading">
        <div style={dep.header}>
          <h2 style={dep.title} id="swap-qusd-to-usdc-heading">
            Swap QUSD to USDC
          </h2>
        </div>
        {pf && !pf.treasury_ready ? (
          <p
            role="alert"
            style={{
              color: "var(--warn)",
              margin: "0 0 14px",
              padding: "12px 14px",
              fontSize: 13,
              lineHeight: 1.55,
              borderRadius: 8,
              border: "1px solid color-mix(in srgb, var(--warn) 35%, var(--border))",
              background: "color-mix(in srgb, var(--warn) 8%, var(--bg))",
              maxWidth: 520,
            }}
          >
            Swaps are paused: treasury needs USDC, at least {(pf.min_treasury_sol_lamports / 1e9).toFixed(3)} SOL for
            fees, and swap env limits must be set.
          </p>
        ) : null}
        {cfg ? (
          <div
            style={{
              marginBottom: 16,
              padding: "14px 16px",
              borderRadius: 8,
              background: "color-mix(in srgb, var(--accent) 5%, var(--bg))",
              border: "1px solid color-mix(in srgb, var(--accent) 22%, var(--border))",
            }}
          >
            <p style={{ margin: "0 0 8px", fontSize: 14, color: "var(--muted)" }}>Exchange rate</p>
            <p style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>
              1 USDC = {rate > 0 ? rate.toLocaleString(undefined, { maximumFractionDigits: 8 }) : "—"} QUSD
            </p>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--muted)", lineHeight: 1.55 }}>
              USDC received = your QUSD ÷ this rate, rounded to 2 decimal places (before per-transaction and treasury
              caps).
            </p>
            <p style={{ margin: "12px 0 0", fontSize: 13, color: "var(--muted)", lineHeight: 1.55 }}>
              Minimum swap: greater than {minAbove.toLocaleString()} QUSD · Max USDC per transaction:{" "}
              {maxU.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
          </div>
        ) : null}
        {cfg && rate > 0 ? (
          <div
            style={{
              marginTop: 0,
              marginBottom: 14,
              padding: 14,
              borderRadius: 8,
              background: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <img src={USDC_ICON} alt="" width={28} height={28} />
              <p style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }} className="mono">
                {hypotheticalFullBalanceUsdc != null
                  ? `${hypotheticalFullBalanceUsdc.toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                      minimumFractionDigits: 2,
                    })} USDC available`
                  : "—"}
              </p>
            </div>
            <p
              style={{
                margin: "10px 0 0",
                fontSize: 12,
                color: "var(--muted)",
                lineHeight: 1.5,
              }}
              className="mono"
            >
              (
              {qusdUnlocked.toLocaleString(undefined, { maximumFractionDigits: 2 })} −{" "}
              {minAbove.toLocaleString(undefined, { maximumFractionDigits: 8 })}) ÷{" "}
              {rate.toLocaleString(undefined, { maximumFractionDigits: 8 })} ={" "}
              {hypotheticalFullBalanceUsdc != null
                ? `${hypotheticalFullBalanceUsdc.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                    minimumFractionDigits: 2,
                  })} USDC`
                : "—"}
            </p>
          </div>
        ) : null}
        <input
          id="swap-qusd-in"
          type="text"
          inputMode="decimal"
          placeholder={`>${minAbove.toLocaleString()} QUSD`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ ...uiInput, maxWidth: 280, marginTop: 6 }}
          disabled={busy || !solReceiveVerified}
          aria-labelledby="swap-qusd-to-usdc-heading"
        />
        {Number.isFinite(qIn) && qIn > 0 && rate > 0 ? (
          <div style={{ marginTop: 16, padding: 14, borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <img src={USDC_ICON} alt="" width={24} height={24} />
              <span style={{ fontWeight: 600 }}>You receive (estimate)</span>
            </div>
            <p style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }} className="mono">
              {usdcOut.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })} USDC
            </p>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--muted)" }}>
              QUSD deducted after caps:{" "}
              <strong className="mono">{qusdDebit.toLocaleString(undefined, { maximumFractionDigits: 8 })}</strong>
              {qusdDebit < qIn - 1e-9 ? (
                <span> (capped by treasury balance or max USDC)</span>
              ) : null}
            </p>
          </div>
        ) : null}

        <button
          type="button"
          style={{ ...uiBtnPrimary, marginTop: 16, opacity: canSubmit ? 1 : 0.55 }}
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          {busy ? "Working…" : "Swap"}
        </button>

        {busy ? (
          <div style={dep.swapProgress} role="status" aria-live="polite" aria-busy="true">
            <p style={dep.swapProgressTitle}>Progress</p>
            <SwapProgressRow
              phase={swapProgressPhase}
              step={1}
              label="Checking your amount and limits"
              isLast={false}
            />
            <SwapProgressRow
              phase={swapProgressPhase}
              step={2}
              label="Updating your QUSD balance"
              isLast={false}
            />
            <SwapProgressRow
              phase={swapProgressPhase}
              step={3}
              label="Sending USDC to your Solana wallet"
              isLast
            />
          </div>
        ) : null}

        {err ? (
          <p role="alert" style={{ marginTop: 12, color: "var(--danger)", fontSize: 14 }}>
            {err}
          </p>
        ) : null}
        {okMsg ? (
          <p style={{ marginTop: 12, color: "var(--ok)", fontSize: 14 }}>
            {okMsg}
          </p>
        ) : null}
      </section>

      <div style={card}>
        <p style={{ margin: "0 0 14px", fontWeight: 650, fontSize: "0.95rem" }}>How it works (summary)</p>

        <p style={dep.summaryDirection}>USDC → QUSD (you send USDC)</p>
        <ul style={dep.summaryListTightBottom}>
          <li style={dep.summaryListLi}>
            <strong>Send USDC</strong> on the Solana network to the address in the panel above (only USDC — wrong tokens
            can be lost).
          </li>
          <li style={dep.summaryListLi}>
            <strong>Wait for confirmation</strong> — your wallet or explorer will show when the transaction settles.
          </li>
          <li style={dep.summaryListLi}>
            <strong>QUSD credit</strong> — we add QUSD to your Solve Quest balance when our system sees the deposit on
            chain.
          </li>
        </ul>
        <p style={dep.summaryFollowText}>
          {autoCreditUsdcEnabled === true ? (
            <>
              <strong>Automatic processing is on:</strong> the server checks the blockchain on a timer (not when you press
              a button). After Solana confirms your transfer, QUSD usually appears within a few minutes — refresh your
              balance or revisit this page.
            </>
          ) : autoCreditUsdcEnabled === false ? (
            <>
              <strong>Automatic chain monitoring may be off</strong> on this deployment. If QUSD doesn’t show up, contact
              support with your transaction signature from your wallet.
            </>
          ) : (
            <>
              After your transfer confirms, QUSD is credited when our backend processes your deposit — often within a few
              minutes.
            </>
          )}
        </p>

        <p style={dep.summaryDirectionSpaced}>QUSD → USDC (in-app swap)</p>
        <ul style={dep.summaryList}>
          <li style={dep.summaryListLi}>You need a verified Solana address on Account — USDC is sent to that wallet.</li>
          <li style={dep.summaryListLi}>
            Each swap amount must be <strong>greater than</strong> the minimum QUSD (see Exchange rate in the panel
            above).
          </li>
          <li style={dep.summaryListLi}>
            USDC out = QUSD ÷ exchange rate (QUSD per 1 USDC), rounded to 2 decimals, then capped by the max USDC per
            transaction and by treasury USDC on hand (if capped, QUSD deducted matches the USDC actually sent).
          </li>
          <li style={dep.summaryListLi}>
            Swaps only run when the treasury holds USDC and enough SOL for fees (≥ 0.001 SOL).
          </li>
          <li style={dep.summaryListLi}>
            On success, QUSD is deducted first; if the USDC transfer fails, your QUSD is refunded automatically.
          </li>
        </ul>
      </div>
    </div>
  );
}
