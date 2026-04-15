import { useCallback, useEffect, useState, type CSSProperties } from "react";
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

type PrizeConfig = {
  prize_amount: number;
  claim_quest_amount: number;
  quest_multiplier: number;
  quest_mint: string | null;
};

type PrizeMe = {
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

export default function PrizeScreen({
  qusdUnlocked,
  solReceiveVerified,
  serverDepositAddress,
  onRefreshAccount,
}: Props) {
  const authMode = useAuthMode();
  const demo = isDemoMode(authMode);

  const [config, setConfig] = useState<PrizeConfig | null>(null);
  const [me, setMe] = useState<PrizeMe | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [qusdDraft, setQusdDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [buyErr, setBuyErr] = useState<string | null>(null);
  const [buyOk, setBuyOk] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/prize/config", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setConfig(j as PrizeConfig);
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
      const r = await fetch("/api/prize/me", { credentials: "include" });
      if (!r.ok) {
        setMe(null);
        return;
      }
      setMe((await r.json()) as PrizeMe);
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

  const submitBuy = useCallback(async () => {
    if (demo || busy) return;
    setBuyErr(null);
    setBuyOk(null);
    const q = Number.parseFloat(qusdDraft.replace(/,/g, ""));
    if (!Number.isFinite(q) || q <= 0) {
      setBuyErr("Enter a positive QUSD amount.");
      return;
    }
    if (!solReceiveVerified) {
      setBuyErr("Verify your Solana address on the Account page first.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/prize/buy-quest", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qusd_amount: q }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        signature?: string;
        quest_amount?: number;
      };
      if (!r.ok) {
        setBuyErr(j.message || j.error || `Request failed (${r.status})`);
        return;
      }
      const sig = j.signature;
      const qa = j.quest_amount;
      setBuyOk(
        sig
          ? `Sent ${qa != null ? `${qa} QUEST` : "QUEST"} — signature ${sig.slice(0, 12)}…`
          : "Purchase completed.",
      );
      setQusdDraft("");
      await refreshMe();
      await onRefreshAccount?.();
    } catch (e) {
      setBuyErr(e instanceof Error ? e.message : "Network error");
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
        . You can purchase QUEST tokens with your{" "}
        <span style={{ whiteSpace: "nowrap" }}>
          <QusdIcon size={16} />
          <strong> QUSD</strong>
        </span>{" "}
        at a rate of <strong>{mult.toLocaleString()} QUSD per 1 QUEST</strong>.
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

        {buyErr ? (
          <p role="alert" style={{ marginTop: 12, color: "var(--danger)", fontSize: 14 }}>
            {buyErr}
          </p>
        ) : null}
        {buyOk ? (
          <p role="status" style={{ marginTop: 12, color: "var(--ok)", fontSize: 14 }}>
            {buyOk}
          </p>
        ) : null}

        <button
          type="button"
          style={{ ...uiBtnPrimary, marginTop: 14, opacity: busy || !solReceiveVerified ? 0.6 : 1 }}
          disabled={busy || !solReceiveVerified}
          onClick={() => void submitBuy()}
        >
          {busy ? "Processing…" : "Buy QUEST"}
        </button>
      </div>
    </div>
  );
}
