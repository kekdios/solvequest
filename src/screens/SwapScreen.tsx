import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { uiBtnPrimary, uiFieldLabel, uiInput } from "../ui/appSurface";
import { QusdIcon } from "../Qusd";
import { computeSwapAmounts } from "../lib/swapAmounts";

const USDC_ICON = "/prize-usdc.png";

type SwapConfig = {
  swap_above_amount: number;
  swap_qusd_usdc_rate: number;
  swap_maximum_usdc_amount: number;
  swap_enabled: boolean;
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

export default function SwapScreen({
  isDemo,
  qusdUnlocked,
  solReceiveVerified,
  onRefreshAccount,
  onGoToAccount,
}: Props) {
  const [cfg, setCfg] = useState<SwapConfig | null>(null);
  const [pf, setPf] = useState<Preflight | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

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
    const b = qusdUnlocked - minAbove;
    if (!(rate > 0) || !Number.isFinite(b) || b <= 0) return null;
    return Math.round((b / rate) * 100) / 100;
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
        setErr(j.message || j.error || `Swap failed (${r.status}).`);
        return;
      }
      setOkMsg(
        `Sent ${j.usdc_sent != null ? j.usdc_sent.toFixed(6) : ""} USDC. Debited ${j.qusd_debited != null ? j.qusd_debited.toFixed(2) : ""} QUSD. Tx: ${j.signature?.slice(0, 12)}…`,
      );
      setDraft("");
      await onRefreshAccount?.();
      loadPreflight();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }, [canSubmit, qIn, onRefreshAccount, loadPreflight]);

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
      {cfg ? (
        <div style={card}>
          <p style={{ margin: "0 0 8px", fontSize: 14, color: "var(--muted)" }}>Exchange rate</p>
          <p style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>
            1 USDC = {rate > 0 ? rate.toLocaleString(undefined, { maximumFractionDigits: 8 }) : "—"} QUSD
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--muted)" }}>
            USDC received = your QUSD ÷ this rate, rounded to 2 decimal places (before per-transaction and treasury
            caps).
          </p>
          <p style={{ margin: "12px 0 0", fontSize: 13, color: "var(--muted)" }}>
            Minimum swap: greater than {minAbove.toLocaleString()} QUSD · Max USDC per transaction:{" "}
            {maxU.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
        </div>
      ) : null}

      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <QusdIcon size={22} />
          <span style={{ fontSize: 14, color: "var(--muted)" }}>Your QUSD balance</span>
        </div>
        <p style={{ margin: 0, fontSize: "1.35rem", fontWeight: 700 }} className="mono">
          {qusdUnlocked.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </p>
      </div>

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

      {pf && !pf.treasury_ready ? (
        <p style={{ color: "var(--warn)", margin: "12px 0", maxWidth: 520 }}>
          Swaps are paused: treasury needs USDC, at least {(pf.min_treasury_sol_lamports / 1e9).toFixed(3)} SOL for
          fees, and swap env limits must be set.
        </p>
      ) : null}

      <div style={card}>
        <label style={uiFieldLabel} htmlFor="swap-qusd-in">
          QUSD to swap
        </label>
        {cfg && rate > 0 ? (
          <div
            style={{
              marginTop: 10,
              marginBottom: 14,
              padding: 14,
              borderRadius: 8,
              background: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
              (QUSD balance − <span className="mono">SWAP_ABOVE_AMOUNT</span>) ÷{" "}
              <span className="mono">SWAP_QUSD_USDC_RATE</span> = USDC
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <img src={USDC_ICON} alt="" width={28} height={28} />
              <div>
                <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>If you could swap that full amount</p>
                <p style={{ margin: "4px 0 0", fontSize: "1.2rem", fontWeight: 700 }} className="mono">
                  {hypotheticalFullBalanceUsdc != null
                    ? `${hypotheticalFullBalanceUsdc.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                        minimumFractionDigits: 2,
                      })} USDC`
                    : "—"}
                </p>
              </div>
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
              QUSD debited after caps:{" "}
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
          {busy ? "Swapping…" : "Swap"}
        </button>

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
      </div>

      <div style={card}>
        <p style={{ margin: "0 0 10px", fontWeight: 650, fontSize: "0.95rem" }}>Swap rules (summary)</p>
        <ul
          style={{
            margin: 0,
            paddingLeft: 18,
            color: "var(--muted)",
            fontSize: 13,
            lineHeight: 1.55,
            maxWidth: 520,
          }}
        >
          <li>You need a verified Solana address on Account — USDC is sent there.</li>
          <li>
            Each swap amount must be <strong>greater than</strong> the minimum QUSD (see the rate card and swap field
            above).
          </li>
          <li>
            USDC out = QUSD ÷ exchange rate (QUSD per 1 USDC), rounded to 2 decimals, then capped by the max USDC per
            transaction and by treasury USDC on hand (if capped, QUSD debited matches the USDC actually sent).
          </li>
          <li>Swaps only run when the treasury holds USDC and enough SOL for fees (≥ 0.001 SOL).</li>
          <li>On success, QUSD is debited first; if the USDC transfer fails, your QUSD is refunded automatically.</li>
        </ul>
      </div>
    </div>
  );
}
