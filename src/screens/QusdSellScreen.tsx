import { useCallback, useEffect, useState, type CSSProperties } from "react";

const PURCHASE_STEPS = [
  "Validating your session and QUSD balance",
  "Connecting to Solana (treasury & QUEST mint)",
  "Reserving QUSD on your account",
  "Sending QUEST to your verified wallet",
] as const;
import { uiBtnPrimary, uiFieldLabel, uiInput } from "../ui/appSurface";
import { QusdIcon } from "../Qusd";
import { isDemoMode, useAuthMode } from "../auth/sessionAuth";

const USDC_ICON = "/prize-usdc.png";
const QUEST_ICON = "/prize-quest.png";

const card: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "18px 20px",
  marginTop: 16,
  maxWidth: 560,
  background: "var(--panel)",
};

type QusdSellConfig = {
  prize_amount: number;
  claim_quest_amount: number;
  quest_multiplier: number;
  quest_mint: string | null;
};

type QusdSellMe = {
  qusd_unlocked: number;
  sol_receive_verified: boolean;
  sol_receive_address: string | null;
  quest_balance: number | null;
};

type Props = {
  qusdUnlocked: number;
  solReceiveVerified: boolean;
  serverDepositAddress: string | null;
  onRefreshAccount?: () => void | Promise<void>;
};

export default function QusdSellScreen({
  qusdUnlocked,
  solReceiveVerified,
  serverDepositAddress,
  onRefreshAccount,
}: Props) {
  const authMode = useAuthMode();
  const demo = isDemoMode(authMode);

  const [config, setConfig] = useState<QusdSellConfig | null>(null);
  const [me, setMe] = useState<QusdSellMe | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [qusdDraft, setQusdDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [purchaseStep, setPurchaseStep] = useState(1);
  const [sellErr, setSellErr] = useState<string | null>(null);
  const [sellErrDetail, setSellErrDetail] = useState<string | null>(null);
  const [sellOk, setSellOk] = useState<string | null>(null);

  useEffect(() => {
    if (!busy) {
      setPurchaseStep(1);
      return;
    }
    setPurchaseStep(1);
    const t2 = window.setTimeout(() => setPurchaseStep(2), 400);
    const t3 = window.setTimeout(() => setPurchaseStep(3), 1000);
    const t4 = window.setTimeout(() => setPurchaseStep(4), 2200);
    return () => {
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
    };
  }, [busy]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/qusd/sell/config", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setConfig(j as QusdSellConfig);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadErr("Could not load prize configuration.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshMe = useCallback(async () => {
    if (demo) return;
    try {
      const r = await fetch("/api/qusd/sell/me", { credentials: "include" });
      if (!r.ok) {
        setMe(null);
        return;
      }
      setMe((await r.json()) as QusdSellMe);
    } catch {
      setMe(null);
    }
  }, [demo]);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  const mult = config?.quest_multiplier ?? 1000;
  const qusdNum = Number.parseFloat(qusdDraft.replace(/,/g, ""));
  const previewQuest =
    Number.isFinite(qusdNum) && qusdNum > 0 ? Math.round((qusdNum / mult) * 1e6) / 1e6 : null;

  const submitSell = useCallback(async () => {
    if (demo || busy) return;
    setSellErr(null);
    setSellErrDetail(null);
    setSellOk(null);
    const q = Number.parseFloat(qusdDraft.replace(/,/g, ""));
    if (!Number.isFinite(q) || q <= 0) {
      setSellErr("Enter a positive QUSD amount.");
      return;
    }
    if (!solReceiveVerified) {
      setSellErr("Verify your Solana address on the Account page first.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/qusd/sell", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qusd_amount: q }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        detail?: string;
        signature?: string;
        quest_amount?: number;
      };
      if (!r.ok) {
        const primary =
          j.message ||
          (typeof j.error === "string"
            ? j.error.replace(/_/g, " ")
            : `Something went wrong (${r.status}).`);
        setSellErr(primary);
        setSellErrDetail(typeof j.detail === "string" && j.detail.trim() ? j.detail.trim() : null);
        return;
      }
      const sig = j.signature;
      const qa = j.quest_amount;
      const baseMsg =
        j.message ||
        (sig
          ? `Sent ${qa != null ? `${qa} QUEST` : "QUEST"} to your wallet.`
          : "Purchase completed.");
      setSellOk(
        sig ? `${baseMsg} Transaction: ${sig.slice(0, 12)}…${sig.slice(-8)}` : baseMsg,
      );
      setQusdDraft("");
      await refreshMe();
      await onRefreshAccount?.();
    } catch (e) {
      setSellErr(e instanceof Error ? e.message : "Network error — check your connection and try again.");
      setSellErrDetail(null);
    } finally {
      setBusy(false);
    }
  }, [busy, demo, onRefreshAccount, qusdDraft, refreshMe, solReceiveVerified]);

  if (demo) {
    return (
      <div style={card}>
        <p style={{ margin: 0, color: "var(--muted)" }}>
          Prize and QUEST purchase run on the live app with a signed-in account. Demo mode uses local balances only.
        </p>
      </div>
    );
  }

  const prizeAmount = config?.prize_amount ?? 0;
  const claimAmt = config?.claim_quest_amount ?? 0;
  const questBal = me?.quest_balance;
  const qusdShow = me?.qusd_unlocked ?? qusdUnlocked;

  return (
    <div>
      {loadErr ? (
        <p role="alert" style={{ color: "var(--danger)" }}>
          {loadErr}
        </p>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
        <img src={USDC_ICON} alt="" width={40} height={40} style={{ objectFit: "contain" }} />
        <span style={{ fontSize: "1.75rem", fontWeight: 700, letterSpacing: "-0.03em" }}>
          ${prizeAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </span>
        <span style={{ color: "var(--muted)", fontSize: 14 }}>prize pool (USDC)</span>
      </div>

      <p style={{ marginTop: 18, lineHeight: 1.6, maxWidth: 640 }}>
        To claim the prize you must have{" "}
        <strong style={{ whiteSpace: "nowrap" }}>
          <img
            src={QUEST_ICON}
            alt=""
            width={18}
            height={18}
            style={{ verticalAlign: "-4px", marginRight: 4, objectFit: "contain" }}
          />
          {claimAmt.toLocaleString(undefined, { maximumFractionDigits: 6 })} QUEST
        </strong>
        . Spend{" "}
        <span style={{ whiteSpace: "nowrap" }}>
          <QusdIcon size={16} />
          <strong> QUSD</strong>
        </span>{" "}
        to receive QUEST at <strong>{mult.toLocaleString()} QUSD per 1 QUEST</strong>.
      </p>

      <div style={card}>
        <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 8 }}>Your QUSD balance</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "1.35rem", fontWeight: 700 }}>
          <QusdIcon size={22} />
          <span className="mono">{qusdShow.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 8 }}>QUEST balance (on-chain)</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "1.25rem", fontWeight: 600 }}>
          <img src={QUEST_ICON} alt="" width={22} height={22} style={{ objectFit: "contain" }} />
          <span className="mono">
            {questBal == null ? "—" : questBal.toLocaleString(undefined, { maximumFractionDigits: 6 })}
          </span>
        </div>
        {config?.quest_mint ? (
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--muted)", wordBreak: "break-all" }}>
            Mint: {config.quest_mint}
          </p>
        ) : null}
      </div>

      <div style={card}>
        <label style={uiFieldLabel} htmlFor="prize-qusd-buy">
          QUSD to spend (buy QUEST)
        </label>
        <input
          id="prize-qusd-buy"
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={qusdDraft}
          onChange={(e) => setQusdDraft(e.target.value)}
          style={{ ...uiInput, maxWidth: 280, marginTop: 6 }}
          disabled={busy || !solReceiveVerified}
        />
        {previewQuest != null && previewQuest > 0 ? (
          <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--muted)" }}>
            → {previewQuest.toLocaleString(undefined, { maximumFractionDigits: 6 })} QUEST (after rounding to 6
            decimals)
          </p>
        ) : null}

        {!solReceiveVerified ? (
          <p role="status" style={{ marginTop: 14, fontSize: 14, color: "var(--muted)" }}>
            Verify your Solana address on the <strong>Account</strong> page to enable QUEST purchases.{" "}
            {serverDepositAddress ? `Current address: ${serverDepositAddress.slice(0, 8)}…` : null}
          </p>
        ) : null}

        <button
          type="button"
          style={{ ...uiBtnPrimary, marginTop: 14, opacity: busy || !solReceiveVerified ? 0.6 : 1 }}
          disabled={busy || !solReceiveVerified}
          onClick={() => void submitSell()}
        >
          {busy ? "Working…" : "Buy QUEST"}
        </button>

        {busy ? (
          <div
            style={{
              marginTop: 14,
              padding: "12px 14px",
              borderRadius: 8,
              background: "color-mix(in srgb, var(--accent) 8%, var(--panel))",
              border: "1px solid var(--border)",
            }}
            aria-live="polite"
            aria-busy="true"
          >
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8, fontWeight: 600 }}>
              Progress
            </div>
            <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
              {PURCHASE_STEPS.map((label, i) => {
                const n = i + 1;
                const done = purchaseStep > n;
                const active = purchaseStep === n;
                return (
                  <li
                    key={label}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      fontSize: 13,
                      lineHeight: 1.45,
                      marginTop: i > 0 ? 8 : 0,
                      color: done ? "var(--ok)" : active ? "var(--text)" : "var(--muted)",
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    <span
                      className="mono"
                      style={{
                        flexShrink: 0,
                        width: 22,
                        textAlign: "center",
                        opacity: active ? 1 : 0.85,
                      }}
                      aria-hidden
                    >
                      {done ? "✓" : active ? "→" : "○"}
                    </span>
                    <span>{label}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}

        {sellErr ? (
          <div role="alert" style={{ marginTop: 12 }}>
            <p style={{ color: "var(--danger)", fontSize: 14, margin: 0, lineHeight: 1.5 }}>{sellErr}</p>
            {sellErrDetail ? (
              <details style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
                <summary style={{ cursor: "pointer", userSelect: "none" }}>Technical details</summary>
                <pre
                  style={{
                    margin: "8px 0 0",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    fontSize: 11,
                    lineHeight: 1.4,
                  }}
                >
                  {sellErrDetail}
                </pre>
              </details>
            ) : null}
          </div>
        ) : null}
        {sellOk ? (
          <p role="status" style={{ marginTop: 12, color: "var(--ok)", fontSize: 14 }}>
            {sellOk}
          </p>
        ) : null}
      </div>
    </div>
  );
}
