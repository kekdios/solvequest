import { useEffect, useState, type CSSProperties } from "react";
import { uiFieldLabel } from "../ui/appSurface";
import { QusdIcon } from "../Qusd";
import { isDemoMode, useAuthMode } from "../auth/sessionAuth";

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
            Daily QUSD prize and prize rules run in the live app with a signed-in account. Demo mode uses local balances
            only.
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
        <QusdIcon size={40} />
        <span style={{ fontSize: "1.75rem", fontWeight: 700, letterSpacing: "-0.03em" }}>
          {prizeAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} QUSD
        </span>
        <span style={{ color: "var(--muted)", fontSize: 14 }}>daily prize pool</span>
      </div>

      <p style={{ marginTop: 18, lineHeight: 1.6, maxWidth: 640 }}>
        <strong>Competition:</strong> you&apos;re racing for this <strong>QUSD</strong> amount on the leaderboard each
        day (rules and eligibility below — they can change).{" "}
        <strong>Each account may win the daily prize at most once.</strong> That&apos;s separate from{" "}
        <strong>trading profits</strong>: when you close trades in the green, your balance grows in QUSD too.
      </p>

      <div
        style={{
          ...card,
          marginTop: 18,
          borderColor: "color-mix(in srgb, var(--accent) 38%, var(--border))",
          background:
            "linear-gradient(165deg, color-mix(in srgb, var(--accent) 10%, var(--panel)) 0%, var(--panel) 100%)",
          boxShadow:
            "0 0 0 1px color-mix(in srgb, var(--accent) 12%, transparent), 0 12px 36px color-mix(in srgb, var(--accent) 12%, transparent)",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: "clamp(1.05rem, 2.5vw, 1.25rem)",
            fontWeight: 750,
            letterSpacing: "-0.02em",
            lineHeight: 1.35,
            color: "var(--text)",
          }}
        >
          Swap QUSD trading profits for USDC *
        </p>
      </div>

      <p style={{ marginTop: 14, lineHeight: 1.6, maxWidth: 640 }}>
        Open <strong>Swap</strong> in the sidebar to convert QUSD (including trading profits) to <strong>USDC</strong> on
        Solana at the app&apos;s rate, sent to your verified receive address. Limits, treasury balance, and verification
        rules apply — see Swap for details.
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
            Verify your Solana address on the <strong>Account</strong> page for deposits, prize-related notices, and
            USDC from Swap.{" "}
            {serverDepositAddress ? `Current address: ${serverDepositAddress.slice(0, 8)}…` : null}
          </p>
        ) : null}
      </div>

      <div style={card}>
        <label style={uiFieldLabel}>Leaderboard</label>
        <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.55, color: "var(--muted)" }}>
          Daily prize competition uses total QUSD (ledger) — open <strong>Leaderboard</strong> in the sidebar for live
          rankings and your <strong>Prize #</strong> (eligible traders only; previous winners show “—”).
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
      Questions about the daily prize or eligibility? Contact{" "}
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
        trading, promotions, and configured on-chain flows only. Daily prize awards and Swap conversion are separate
        systems with their own rules.
      </p>
    </div>
  );
}
