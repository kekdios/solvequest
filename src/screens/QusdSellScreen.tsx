import { useEffect, useState, type CSSProperties } from "react";
import { uiFieldLabel } from "../ui/appSurface";
import { QusdIcon } from "../Qusd";
import { isDemoMode, useAuthMode } from "../auth/sessionAuth";

const USDC_ICON = "/prize-usdc.png";
const PRIZE_CONTACT_EMAIL = "privacyemail369@gmail.com";

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
}: Props) {
  const authMode = useAuthMode();
  const demo = isDemoMode(authMode);

  const [config, setConfig] = useState<PrizeConfig | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

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

  if (demo) {
    return (
      <div>
        <div style={card}>
          <p style={{ margin: 0, color: "var(--muted)" }}>
            Prize pool details run on the live app with a signed-in account. Demo mode uses local balances only.
          </p>
          <PrizeContactLine style={{ marginTop: 16 }} />
        </div>
        <SybilProofNote />
      </div>
    );
  }

  const prizeAmount = config?.prize_amount ?? 0;

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
        Seasonal rules, eligibility, and how the USDC pool is awarded are described here and may change between seasons.
        Use the contact below for prize questions.
      </p>

      <PrizeContactLine />

      <div style={card}>
        <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 8 }}>Your QUSD balance</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "1.35rem", fontWeight: 700 }}>
          <QusdIcon size={22} />
          <span className="mono">{qusdUnlocked.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        </div>
        {!solReceiveVerified ? (
          <p style={{ margin: "12px 0 0", fontSize: 13, color: "var(--muted)" }}>
            Verify your Solana address on the <strong>Account</strong> page for deposits and payouts.{" "}
            {serverDepositAddress ? `Current address: ${serverDepositAddress.slice(0, 8)}…` : null}
          </p>
        ) : null}
      </div>

      <div style={card}>
        <label style={uiFieldLabel}>Leaderboard</label>
        <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.55, color: "var(--muted)" }}>
          Rankings use total QUSD (ledger). Open <strong>Leaderboard</strong> in the sidebar for the live table.
        </p>
      </div>

      <SybilProofNote />
    </div>
  );
}

function PrizeContactLine({ style }: { style?: CSSProperties }) {
  return (
    <p
      style={{
        marginTop: 14,
        fontSize: 14,
        lineHeight: 1.55,
        color: "var(--muted)",
        maxWidth: 640,
        ...style,
      }}
    >
      To claim prize contact{" "}
      <a href={`mailto:${PRIZE_CONTACT_EMAIL}`} style={{ color: "var(--accent)", wordBreak: "break-all" }}>
        {PRIZE_CONTACT_EMAIL}
      </a>
    </p>
  );
}

function SybilProofNote() {
  return (
    <div
      style={{
        ...card,
        marginTop: 20,
        maxWidth: 640,
      }}
    >
      <h2 style={{ margin: "0 0 10px", fontSize: "1rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
        Fair play
      </h2>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--muted)" }}>
        <strong style={{ color: "var(--text)" }}>QUSD cannot be transferred between users.</strong> Balances come from
        trading, promotions, and configured on-chain flows only.
      </p>
    </div>
  );
}
