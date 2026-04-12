import { lazy, Suspense, useEffect, useState, type CSSProperties } from "react";
import {
  uiBtnGhost,
  uiBtnPrimary,
  uiFieldLabel,
  uiInput,
  uiOrderCard,
  uiSectionH3,
} from "../ui/appSurface";
import {
  BONUS_REPAYMENT_USDC,
  INITIAL_FREE_QUSD_GRANT,
  LOCKED_QUSD_COOLDOWN_MS,
  QUSD_PER_USD,
  QUSD_DAILY_INTEREST_RATE,
} from "../engine/qusdVault";
import { QusdAmount } from "../Qusd";
import type { PersistedAccountRow } from "../db/persistedAccount";

const TestReceiveAddresses = lazy(() => import("../components/TestReceiveAddresses"));

const CHANGENOW_URL = "https://changenow.io/";

function formatLedgerValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (key === "created_at" || key === "updated_at") {
    const n = Number(value);
    return Number.isFinite(n) ? new Date(n).toISOString() : String(value);
  }
  if (typeof value === "number") return String(value);
  return String(value);
}

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
  /** When logged in, full SQLite `accounts` row from GET /api/account/me (read-only display). */
  ledgerAccountRow?: PersistedAccountRow | null;
  qusdUnlocked: number;
  qusdLocked: number;
  onLockQusd: (amountQusd: number) => void;
  onUnlockQusd: (amountQusd: number) => void;
  bonusRepaidUsdc: number;
  usdcBalance: number;
  sendUnlocked: boolean;
  vaultActivityAt: number | null;
  onRepayBonusUsdc: (amountUsdc: number) => void;
  /** Convert USDC → unlocked QUSD at 100:1. */
  onUnlockedTopUpUsdc: (usdc: number) => void;
  /** Convert unlocked QUSD → USDC at 100 QUSD : 1 USDC (amount is USDC to receive). */
  onUnlockedWithdrawUsdc: (usdc: number) => void;
};

export default function AccountScreen({
  isDemo = false,
  ledgerAccountRow = null,
  qusdUnlocked,
  qusdLocked,
  onLockQusd,
  onUnlockQusd,
  bonusRepaidUsdc,
  usdcBalance,
  sendUnlocked,
  vaultActivityAt,
  onRepayBonusUsdc,
  onUnlockedTopUpUsdc,
  onUnlockedWithdrawUsdc,
}: Props) {
  const totalQusd = qusdUnlocked + qusdLocked;
  const [unlockConvertStr, setUnlockConvertStr] = useState("");
  const [depositStr, setDepositStr] = useState("");
  const [withdrawStr, setWithdrawStr] = useState("");
  const [repayStr, setRepayStr] = useState("");
  const [withdrawalModalOpen, setWithdrawalModalOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!withdrawalModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWithdrawalModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [withdrawalModalOpen]);

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

  const bonusRemaining = Math.max(0, BONUS_REPAYMENT_USDC - bonusRepaidUsdc);
  const canRequestWithdrawal = usdcBalance > 1e-9;
  const repayAmount = Math.max(0, Number(repayStr) || 0);
  const repayApply = Math.min(repayAmount, bonusRemaining, usdcBalance);
  const canRepay = repayApply > 1e-9;

  const unlockUsdcAmt = Math.max(0, Number(unlockConvertStr) || 0);
  const canTopUpUnlocked = unlockUsdcAmt > 1e-9 && unlockUsdcAmt <= usdcBalance + 1e-9;
  const qusdOutForWithdraw = unlockUsdcAmt * QUSD_PER_USD;
  const canWithdrawUnlocked = unlockUsdcAmt > 1e-9 && qusdOutForWithdraw <= qusdUnlocked + 1e-9;

  const dailyPct = QUSD_DAILY_INTEREST_RATE * 100;

  return (
    <div className="app-page" style={s.wrap}>
      <div style={s.metricsStack}>
        <section
          style={{ ...s.statHero, ...s.walletPanelTop }}
          aria-label="Account balance and external funds"
        >
          <p style={{ ...s.statLabel, color: "var(--text)", fontWeight: 700 }}>Account Balance</p>
          <div style={s.walletBalanceRow}>
            <div style={s.walletBalanceAmount}>
              <img
                src="/icon-usdc.png"
                alt=""
                width={24}
                height={24}
                style={s.walletUsdcIcon}
              />
              <span className="mono" style={s.walletBalanceFigures}>
                {usdcBalance.toFixed(4)}
              </span>
              <span style={s.walletBalanceUnit}> USDC</span>
            </div>
            <p style={s.buySellLineWallet}>
              <a href={CHANGENOW_URL} target="_blank" rel="noopener noreferrer" style={s.buySellLink}>
                Buy/Sell cryptocurrencies
              </a>{" "}
              <span style={{ color: "var(--muted)" }}>— instant swaps via ChangeNOW.</span>
            </p>
          </div>
          {isDemo ? (
            <h3 style={s.walletExternalHeading}>External funds (after registration)</h3>
          ) : null}
          {isDemo ? (
            <p style={s.walletExternalIntro}>
              You are in <strong style={{ color: "var(--text)" }}>demo mode</strong>: USDC and QUSD balances
              for this session live in this browser only. A custodial Solana address and on-chain USDC deposits will be
              available after you register (coming next).
            </p>
          ) : (
            <>
              <p style={s.walletExternalIntro}>Used to purchase QUSD</p>
              <div style={s.receiveAddressesBlock}>
                <Suspense fallback={<p style={s.suspenseFallback}>Loading deposit address…</p>}>
                  <TestReceiveAddresses />
                </Suspense>
              </div>
            </>
          )}
          <div style={s.externalRowWallet}>
            <button
              type="button"
              className="wallet-send-btn"
              style={s.btnGhost}
              title={
                canRequestWithdrawal
                  ? undefined
                  : "Fund your account with USDC to request withdrawal"
              }
              aria-disabled={!canRequestWithdrawal}
              onClick={() => {
                if (!canRequestWithdrawal) return;
                setWithdrawalModalOpen(true);
              }}
            >
              Request Withdrawal
            </button>
          </div>
          {!sendUnlocked ? (
            <div style={s.sendLockedHints}>
              <p style={s.sendLockedHint}>
                {`Request Withdrawal is locked until the $${BONUS_REPAYMENT_USDC} bonus is repaid in USDC/USDT (see Bonus above).`}
              </p>
              <p style={s.sendLockedHintFollow}>
                Request Withdrawal is locked until ALL losses are repaid in USDC/USDT ($1 USDC/USDT = 100
                QUSD).
              </p>
            </div>
          ) : null}
          {withdrawalModalOpen ? (
            <div
              style={s.withdrawalModalBackdrop}
              role="dialog"
              aria-modal="true"
              aria-labelledby="withdrawal-coming-soon-title"
              onClick={() => setWithdrawalModalOpen(false)}
            >
              <div style={s.withdrawalModal} onClick={(e) => e.stopPropagation()}>
                <h4 id="withdrawal-coming-soon-title" style={s.withdrawalModalTitle}>
                  Coming Soon
                </h4>
                <button
                  type="button"
                  style={s.btnPrimary}
                  onClick={() => setWithdrawalModalOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
          ) : null}
        </section>

        {ledgerAccountRow && !isDemo ? (
          <section style={s.dbLedgerSection} aria-label="Server database account row">
            <h3 style={s.dbLedgerTitle}>Ledger (SQLite)</h3>
            <p style={s.dbLedgerLead}>
              Read-only snapshot from the server <code style={s.dbLedgerCode}>accounts</code> row for your
              login. Trading and vault actions apply in the app only until the API persists them.
            </p>
            <dl style={s.dbLedgerDl}>
              {Object.entries(ledgerAccountRow as Record<string, unknown>).map(([key, value]) => (
                <div key={key} style={s.dbLedgerRow}>
                  <dt style={s.dbLedgerDt}>{key}</dt>
                  <dd style={s.dbLedgerDd} className="mono">
                    {formatLedgerValue(key, value)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

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
          <p style={s.unlockedConvertHint}>
            $1 USDC = {QUSD_PER_USD} QUSD. Top up from your wallet, or withdraw to USDC.
          </p>
          <div style={s.unlockedConvertRow}>
            <label style={s.unlockedField}>
              <span style={s.label}>Amount (USDC)</span>
              <input
                className="mono"
                inputMode="decimal"
                placeholder="0"
                value={unlockConvertStr}
                onChange={(e) => setUnlockConvertStr(e.target.value)}
                style={s.unlockedConvertInput}
              />
            </label>
            <button
              type="button"
              style={s.btnPrimary}
              aria-disabled={!canTopUpUnlocked}
              onClick={() => {
                if (!canTopUpUnlocked) return;
                onUnlockedTopUpUsdc(unlockUsdcAmt);
                setUnlockConvertStr("");
              }}
            >
              Top up
            </button>
            <button
              type="button"
              style={s.btnGhost}
              aria-disabled={!canWithdrawUnlocked}
              onClick={() => {
                if (!canWithdrawUnlocked) return;
                onUnlockedWithdrawUsdc(unlockUsdcAmt);
                setUnlockConvertStr("");
              }}
            >
              Withdraw
            </button>
          </div>
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
        <section style={{ ...s.statHero, ...s.balancePanelBonus }} aria-label="Bonus QUSD">
          <p style={s.statLabel}>Bonus</p>
          <div style={s.statHeroValue}>
            <QusdAmount
              value={INITIAL_FREE_QUSD_GRANT}
              maximumFractionDigits={0}
              strong
              color="var(--accent)"
              iconSize={STAT_ICON_MD}
              amountStyle={statAmountStyle}
            />
          </div>
          <p style={s.statSub}>
            Starting grant ({INITIAL_FREE_QUSD_GRANT.toLocaleString()} QUSD). Pay{" "}
            <strong style={{ color: "var(--text)" }}>${BONUS_REPAYMENT_USDC} USDC/USDT</strong> from your
            wallet to unlock <strong style={{ color: "var(--text)" }}>Request Withdrawal</strong>.
          </p>
          <p style={s.bonusProgress} className="mono">
            Repaid: {bonusRepaidUsdc.toFixed(2)} / {BONUS_REPAYMENT_USDC} USDC
            {sendUnlocked ? (
              <span style={{ color: "var(--ok)", marginLeft: 8 }}>· Request Withdrawal unlocked</span>
            ) : null}
          </p>
          {!sendUnlocked ? (
            <div style={s.bonusRepayRow}>
              <input
                className="mono"
                inputMode="decimal"
                placeholder="0"
                value={repayStr}
                onChange={(e) => setRepayStr(e.target.value)}
                style={s.bonusRepayInput}
                aria-label="USDC amount toward bonus"
              />
              <button
                type="button"
                style={s.btnPrimary}
                aria-disabled={!canRepay}
                onClick={() => {
                  if (!canRepay) return;
                  onRepayBonusUsdc(repayApply);
                  setRepayStr("");
                }}
              >
                Apply USDC
              </button>
            </div>
          ) : null}
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
  dbLedgerSection: {
    ...uiOrderCard,
    padding: "18px 20px",
  },
  dbLedgerTitle: {
    margin: "0 0 8px",
    fontSize: "1.05rem",
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: "var(--text)",
  },
  dbLedgerLead: {
    margin: "0 0 14px",
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--muted)",
  },
  dbLedgerCode: {
    fontSize: "0.95em",
    color: "var(--accent)",
  },
  dbLedgerDl: {
    margin: 0,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)",
    gap: "6px 16px",
    fontSize: 13,
    alignItems: "start",
  },
  dbLedgerRow: {
    display: "contents",
  },
  dbLedgerDt: {
    margin: 0,
    color: "var(--muted)",
    fontWeight: 500,
  },
  dbLedgerDd: {
    margin: 0,
    color: "var(--text)",
    wordBreak: "break-word",
  },
  walletPanelTop: {
    width: "100%",
    background:
      "linear-gradient(135deg, color-mix(in srgb, var(--accent) 14%, var(--panel)) 0%, var(--surface) 100%)",
    border: "1px solid color-mix(in srgb, var(--accent) 32%, var(--border))",
    boxShadow:
      "inset 0 1px 0 color-mix(in srgb, var(--text) 5%, transparent), 0 6px 28px color-mix(in srgb, var(--accent) 8%, transparent)",
  },
  walletBalanceFigures: {
    fontSize: STAT_VALUE_FS,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: "var(--accent)",
  },
  walletBalanceUnit: {
    fontSize: STAT_VALUE_FS,
    fontWeight: 600,
    color: "var(--muted)",
  },
  walletBalanceRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px 16px",
    marginBottom: 4,
  },
  walletBalanceAmount: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    minHeight: "1.5rem",
    flex: "0 1 auto",
  },
  walletUsdcIcon: {
    display: "block",
    flexShrink: 0,
    objectFit: "contain",
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
  buySellLineWallet: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text)",
    textAlign: "right",
    flex: "1 1 200px",
    minWidth: 0,
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
  unlockedConvertHint: {
    margin: "10px 0 0",
    fontSize: 11,
    lineHeight: 1.45,
    color: "var(--muted)",
  },
  unlockedConvertRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-end",
    gap: 10,
    marginTop: 10,
  },
  unlockedField: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    flex: "1 1 140px",
    minWidth: 0,
  },
  unlockedConvertInput: {
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--text)",
    padding: "8px 10px",
    fontSize: 14,
  },
  balancePanelLocked: {
    background:
      "linear-gradient(135deg, color-mix(in srgb, var(--warn) 10%, var(--panel)) 0%, var(--surface) 100%)",
    border: "1px solid color-mix(in srgb, var(--warn) 32%, var(--border))",
    boxShadow: "inset 0 1px 0 color-mix(in srgb, var(--text) 5%, transparent)",
  },
  balancePanelBonus: {
    background:
      "linear-gradient(135deg, color-mix(in srgb, #a78bfa 12%, var(--panel)) 0%, var(--surface) 100%)",
    border: "1px solid color-mix(in srgb, #a78bfa 38%, var(--border))",
    boxShadow: "inset 0 1px 0 color-mix(in srgb, var(--text) 5%, transparent)",
  },
  bonusProgress: {
    margin: "10px 0 0",
    fontSize: 12,
    color: "var(--muted)",
  },
  bonusRepayRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
  },
  bonusRepayInput: {
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--text)",
    padding: "8px 10px",
    fontSize: 14,
    minWidth: 0,
    flex: "1 1 120px",
  },
  sendLockedHints: {
    marginTop: 10,
  },
  sendLockedHint: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--warn)",
  },
  sendLockedHintFollow: {
    margin: "8px 0 0",
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--warn)",
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
  externalRowWallet: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
    marginBottom: 4,
  },
  withdrawalModalBackdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    background: "rgba(0,0,0,0.72)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  withdrawalModal: {
    background: "var(--surface)",
    border: "1px solid color-mix(in srgb, var(--border) 85%, var(--text))",
    borderRadius: 12,
    padding: "24px 22px",
    maxWidth: 360,
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 16,
    boxShadow:
      "inset 0 1px 0 color-mix(in srgb, var(--text) 5%, transparent), 0 8px 32px color-mix(in srgb, var(--text) 8%, transparent)",
  },
  withdrawalModalTitle: {
    margin: 0,
    fontSize: "1.125rem",
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: "var(--text)",
  },
  suspenseFallback: { margin: "8px 0 0", fontSize: 13, color: "var(--muted)" },
  buySellLink: {
    color: "var(--accent)",
    fontWeight: 700,
    textDecoration: "underline",
    textUnderlineOffset: 2,
  },
};
