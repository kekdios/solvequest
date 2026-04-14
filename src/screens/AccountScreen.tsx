import { lazy, Suspense, useEffect, useState, type CSSProperties } from "react";
import {
  uiBtnGhost,
  uiBtnPrimary,
  uiFieldLabel,
  uiInput,
  uiOrderCard,
  uiSectionH3,
} from "../ui/appSurface";
import { LOCKED_QUSD_COOLDOWN_MS, QUSD_PER_USD, QUSD_DAILY_INTEREST_RATE } from "../engine/qusdVault";
import { QusdAmount } from "../Qusd";

const TestReceiveAddresses = lazy(() => import("../components/TestReceiveAddresses"));

const CHANGENOW_URL = "https://changenow.io/";

/** Stat value text was 2rem; reduced by 40% → 60% scale. */
const STAT_VALUE_FS = "1.2rem";
const STAT_ICON_LG = 14;
const STAT_ICON_MD = 13;
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
  qusdLocked: number;
  onLockQusd: (amountQusd: number) => void;
  onUnlockQusd: (amountQusd: number) => void;
  vaultActivityAt: number | null;
};

export default function AccountScreen({
  isDemo = false,
  serverDepositAddress = null,
  depositAddressError = null,
  qusdUnlocked,
  qusdLocked,
  onLockQusd,
  onUnlockQusd,
  vaultActivityAt,
}: Props) {
  const totalQusd = qusdUnlocked + qusdLocked;
  const [depositStr, setDepositStr] = useState("");
  const [withdrawStr, setWithdrawStr] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const depositQusd = Math.max(0, Number(depositStr) || 0);
  const withdrawQusd = Math.max(0, Number(withdrawStr) || 0);

  /** Allow tiny float slack so valid amounts aren’t rejected vs balance. */
  const canLock = depositQusd > 0 && depositQusd <= qusdUnlocked + 1e-6;
  const unlockAllowedAt =
    vaultActivityAt === null ? null : vaultActivityAt + LOCKED_QUSD_COOLDOWN_MS;
  const vaultCooldownActive =
    unlockAllowedAt !== null && now < unlockAllowedAt && qusdLocked > 1e-9;
  const canUnlockByTimer = !vaultCooldownActive;
  const canUnlock =
    canUnlockByTimer && withdrawQusd > 0 && withdrawQusd <= qusdLocked + 1e-6;

  const deposit = () => {
    if (!canLock) return;
    onLockQusd(Math.min(depositQusd, qusdUnlocked));
    setDepositStr("");
  };

  const withdraw = () => {
    if (!canUnlock) return;
    onUnlockQusd(Math.min(withdrawQusd, qusdLocked));
    setWithdrawStr("");
  };

  const dailyPct = QUSD_DAILY_INTEREST_RATE * 100;

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
                your <strong style={{ color: "var(--text)" }}>unlocked</strong> balance after the deposit is
                confirmed on-chain.
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
        <section style={s.statHero} aria-label="Total QUSD">
          <p style={s.statLabel}>Total QUSD</p>
          <div style={s.statHeroValue}>
            <QusdAmount
              value={totalQusd}
              maximumFractionDigits={2}
              strong
              color="var(--accent)"
              iconSize={STAT_ICON_LG}
              amountStyle={statAmountStyle}
            />
          </div>
          <p style={s.statSub}>Unlocked + Locked</p>
        </section>
        <section style={{ ...s.statHero, ...s.balancePanelUnlocked }} aria-label="Unlocked QUSD">
          <p style={s.statLabel}>Unlocked</p>
          <div style={s.statHeroValue}>
            <QusdAmount
              value={qusdUnlocked}
              maximumFractionDigits={2}
              strong
              color="var(--text)"
              iconSize={STAT_ICON_MD}
              amountStyle={statAmountStyle}
            />
          </div>
          <p style={s.statSub}>Available to lock or spend as unlocked QUSD.</p>
        </section>
        <section style={{ ...s.statHero, ...s.balancePanelLocked }} aria-label="Locked QUSD">
          <p style={s.statLabel}>Locked</p>
          <div style={s.statHeroValue}>
            <QusdAmount
              value={qusdLocked}
              maximumFractionDigits={2}
              strong
              color="var(--warn)"
              iconSize={STAT_ICON_MD}
              amountStyle={statAmountStyle}
            />
          </div>
          <p style={s.statSub}>Earning {dailyPct}% per day; interest adds to this balance each minute.</p>
        </section>
        </div>
      </div>

      <section style={s.card}>
        <h3 style={s.h3}>Vault</h3>
        <p style={s.intro}>
          Deposit and withdraw in <strong style={{ color: "var(--text)" }}>QUSD</strong> (no conversion).{" "}
          <strong style={{ color: "var(--ok)" }}>{dailyPct}% per day</strong> on locked QUSD; interest to your
          locked balance <strong>once per minute</strong> (demo). Locked QUSD cannot move to Unlocked until{" "}
          <strong style={{ color: "var(--text)" }}>90 days</strong> have passed since your last lock or
          unlock; any new lock or unlock resets that timer.
        </p>

        {vaultCooldownActive && unlockAllowedAt !== null ? (
          <p style={s.cooldownBanner} role="status">
            Unlock available after{" "}
            <strong className="mono" style={{ color: "var(--warn)" }}>
              {new Date(unlockAllowedAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </strong>{" "}
            (90 days from last vault activity).
          </p>
        ) : null}

        <div style={s.fieldRow}>
          <label style={s.field}>
            <span style={s.label}>Deposit (lock) — QUSD</span>
            <input
              className="mono"
              inputMode="decimal"
              placeholder="0"
              value={depositStr}
              onChange={(e) => setDepositStr(e.target.value)}
              style={s.input}
            />
          </label>
          <button
            type="button"
            style={s.btnPrimary}
            aria-disabled={!canLock}
            onClick={deposit}
          >
            Lock
          </button>
        </div>

        <div style={s.fieldRow}>
          <label style={s.field}>
            <span style={s.label}>Withdraw (unlock) — QUSD</span>
            <input
              className="mono"
              inputMode="decimal"
              placeholder="0"
              value={withdrawStr}
              onChange={(e) => setWithdrawStr(e.target.value)}
              style={s.input}
            />
          </label>
          <button
            type="button"
            style={s.btnGhost}
            aria-disabled={!canUnlock}
            onClick={withdraw}
          >
            Unlock
          </button>
        </div>
      </section>
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
  balancePanelUnlocked: {
    background:
      "linear-gradient(135deg, color-mix(in srgb, var(--accent) 8%, var(--panel)) 0%, var(--surface) 100%)",
    border: "1px solid color-mix(in srgb, var(--accent) 26%, var(--border))",
    boxShadow: "inset 0 1px 0 color-mix(in srgb, var(--text) 5%, transparent)",
  },
  balancePanelLocked: {
    background:
      "linear-gradient(135deg, color-mix(in srgb, var(--warn) 10%, var(--panel)) 0%, var(--surface) 100%)",
    border: "1px solid color-mix(in srgb, var(--warn) 32%, var(--border))",
    boxShadow: "inset 0 1px 0 color-mix(in srgb, var(--text) 5%, transparent)",
  },
  cooldownBanner: {
    margin: "0 0 16px",
    padding: "12px 14px",
    borderRadius: 8,
    background: "color-mix(in srgb, var(--warn) 10%, var(--bg))",
    border: "1px solid color-mix(in srgb, var(--warn) 28%, var(--border))",
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text)",
  },
  card: {
    ...uiOrderCard,
  },
  h3: { ...uiSectionH3 },
  intro: { margin: "0 0 16px", fontSize: 13, lineHeight: 1.55, color: "var(--muted)" },
  fieldRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-end",
    gap: 12,
    marginBottom: 14,
  },
  field: { display: "flex", flexDirection: "column", gap: 6, flex: "1 1 200px", minWidth: 0 },
  label: { ...uiFieldLabel },
  input: {
    ...uiInput,
  },
  btnPrimary: {
    ...uiBtnPrimary,
    whiteSpace: "nowrap",
  },
  btnGhost: {
    ...uiBtnGhost,
    whiteSpace: "nowrap",
  },
  receiveAddressesBlock: {
    marginTop: 4,
    marginBottom: 8,
  },
  suspenseFallback: { margin: "8px 0 0", fontSize: 13, color: "var(--muted)" },
  buySellLink: {
    color: "var(--accent)",
    fontWeight: 700,
    textDecoration: "underline",
    textUnderlineOffset: 2,
  },
};
