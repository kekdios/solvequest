import { lazy, Suspense, type CSSProperties } from "react";
import { uiFieldLabel } from "../ui/appSurface";
import { QUSD_PER_USD } from "../engine/qusdVault";
import { QusdAmount } from "../Qusd";

const TestReceiveAddresses = lazy(() => import("../components/TestReceiveAddresses"));

const CHANGENOW_URL = "https://changenow.io/";

/** Stat value text was 2rem; reduced by 40% → 60% scale. */
const STAT_VALUE_FS = "1.2rem";
const STAT_ICON_LG = 14;
const statAmountStyle = {
  fontSize: STAT_VALUE_FS,
  fontWeight: 700,
  letterSpacing: "-0.02em",
} as const;

type Props = {
  /** Anonymous demo: no Solana deposit UI; balances stay in-browser only. */
  isDemo?: boolean;
  /** Server custodial Solana address (per registered account). */
  serverDepositAddress?: string | null;
  /** Shown when ensure-custodial or /api/account/me failed, or address missing. */
  depositAddressError?: string | null;
  qusdUnlocked: number;
};

export default function AccountScreen({
  isDemo = false,
  serverDepositAddress = null,
  depositAddressError = null,
  qusdUnlocked,
}: Props) {
  return (
    <div className="app-page" style={s.wrap}>
      <div style={s.metricsStack}>
        <section
          style={{ ...s.statHero, ...s.walletPanelTop }}
          aria-label="Solana USDC deposit address"
        >
          <p style={{ ...s.statLabel, color: "var(--text)", fontWeight: 700 }}>Deposit USDC (Solana)</p>
          {isDemo ? (
            <>
              <h3 style={s.walletExternalHeading}>External funds (after registration)</h3>
              <p style={s.walletExternalIntro}>
                You are in <strong style={{ color: "var(--text)" }}>demo mode</strong>: USDC and QUSD balances
                for this session live in this browser only. A custodial Solana address and on-chain USDC deposits will be
                available after you register (coming next).
              </p>
            </>
          ) : (
            <>
              <p style={s.depositExplainer}>
                All USDC (SPL on Solana) sent to this address is converted to QUSD using the{" "}
                <strong style={{ color: "var(--text)" }}>QUSD_MULTIPLIER</strong> rate (
                <strong style={{ color: "var(--text)" }}>{QUSD_PER_USD} QUSD per $1 USDC</strong>) and added to
                your balance after the deposit is confirmed on-chain.
              </p>
              <div style={s.receiveAddressesBlock}>
                <Suspense fallback={<p style={s.suspenseFallback}>Loading deposit address…</p>}>
                  <TestReceiveAddresses
                    serverDepositAddress={serverDepositAddress}
                    depositAddressError={depositAddressError}
                  />
                </Suspense>
              </div>
              <p style={s.depositBuySell}>
                <a href={CHANGENOW_URL} target="_blank" rel="noopener noreferrer" style={s.buySellLink}>
                  Buy/Sell cryptocurrencies
                </a>{" "}
                <span style={{ color: "var(--muted)" }}>— instant swaps via ChangeNOW.</span>
              </p>
            </>
          )}
        </section>

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
      </div>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  wrap: { display: "flex", flexDirection: "column", gap: 16 },
  metricsStack: { display: "flex", flexDirection: "column", gap: 16 },
  walletPanelTop: {
    width: "100%",
    background:
      "linear-gradient(135deg, color-mix(in srgb, var(--accent) 14%, var(--panel)) 0%, var(--surface) 100%)",
    border: "1px solid color-mix(in srgb, var(--accent) 32%, var(--border))",
    boxShadow:
      "inset 0 1px 0 color-mix(in srgb, var(--text) 5%, transparent), 0 6px 28px color-mix(in srgb, var(--accent) 8%, transparent)",
  },
  depositBuySell: {
    margin: "12px 0 0",
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text)",
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
  receiveAddressesBlock: { marginTop: 8 },
  suspenseFallback: { fontSize: 13, color: "var(--muted)" },
  buySellLink: { color: "var(--accent)", fontWeight: 600 },
};
