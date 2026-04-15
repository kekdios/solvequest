import { lazy, Suspense, useCallback, useEffect, useState, type CSSProperties } from "react";
import { uiBtnPrimary, uiFieldLabel, uiInput } from "../ui/appSurface";
import { resolveTreasuryAddressBase58 } from "../deposit/chainConfig";
import { QUSD_PER_USD } from "../engine/qusdVault";
import { QusdAmount } from "../Qusd";

const TestReceiveAddresses = lazy(() => import("../components/TestReceiveAddresses"));

const CHANGENOW_URL = "https://changenow.io/";

const SIGNUP_GRANT_QUSD = 10_000;
const EMAIL_OTP_BONUS_QUSD = 10_000;
const VERIFY_BONUS_QUSD = 10_000;

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
  isDemo = false,
  serverDepositAddress = null,
  solReceiveVerified = false,
  depositAddressError = null,
  qusdUnlocked,
  onRefreshAccount,
}: Props) {
  const [draftAddress, setDraftAddress] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [treasuryAddress, setTreasuryAddress] = useState<string | null>(null);
  const [treasuryLoadState, setTreasuryLoadState] = useState<"idle" | "loading" | "missing">("idle");

  const verified = Boolean(solReceiveVerified);
  const displayAddr = serverDepositAddress?.trim() ?? "";

  useEffect(() => {
    if (verified && displayAddr) setDraftAddress(displayAddr);
  }, [verified, displayAddr]);

  useEffect(() => {
    if (isDemo || !verified) {
      setTreasuryAddress(null);
      setTreasuryLoadState("idle");
      return;
    }
    let cancelled = false;
    setTreasuryLoadState("loading");
    void resolveTreasuryAddressBase58().then((addr) => {
      if (cancelled) return;
      if (addr) {
        setTreasuryAddress(addr);
        setTreasuryLoadState("idle");
      } else {
        setTreasuryAddress(null);
        setTreasuryLoadState("missing");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isDemo, verified]);

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
    } catch (e) {
      setVerifyError(e instanceof Error ? e.message : "Network error");
    } finally {
      setVerifyBusy(false);
    }
  }, [draftAddress, verifyBusy, verified, onRefreshAccount]);

  return (
    <div className="app-page" style={s.wrap}>
      <div style={s.metricsStack}>
        <section
          style={{ ...s.statHero, ...s.walletPanelTop }}
          aria-label="Solana address and USDC deposits"
        >
          <p style={{ ...s.statLabel, color: "var(--text)", fontWeight: 700 }}>Solana address</p>

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
                You receive <strong style={{ color: "var(--text)" }}>{SIGNUP_GRANT_QUSD.toLocaleString()} QUSD</strong>{" "}
                when your account is created,{" "}
                <strong style={{ color: "var(--text)" }}>{EMAIL_OTP_BONUS_QUSD.toLocaleString()} QUSD</strong> after your
                first successful email code verification, and an additional{" "}
                <strong style={{ color: "var(--text)" }}>{VERIFY_BONUS_QUSD.toLocaleString()} QUSD</strong> after you link
                and verify a <strong style={{ color: "var(--text)" }}>Solana mainnet</strong> address (valid pubkey and a
                small on-chain SOL balance). The linked address is used for USDC (SPL) deposits—converted to QUSD at{" "}
                <strong style={{ color: "var(--text)" }}>{QUSD_PER_USD} QUSD per $1 USDC</strong> when deposits are
                confirmed—and cannot be changed later.
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

              {verified && displayAddr ? (
                <>
                  <p style={s.depositExplainerSecondary}>
                    USDC (SPL) sent to <strong style={{ color: "var(--text)" }}>your verified wallet</strong> (the
                    field above) is credited as QUSD after on-chain confirmation. Use the treasury address below for
                    deposits that should use the project <code style={s.inlineCodeEnv}>SOLANA_TREASURY_ADDRESS</code>.
                  </p>
                  <div style={s.receiveAddressesBlock}>
                    <Suspense fallback={<p style={s.suspenseFallback}>Loading…</p>}>
                      {treasuryLoadState === "loading" ? (
                        <p style={s.suspenseFallback}>Loading treasury address…</p>
                      ) : treasuryLoadState === "missing" || !treasuryAddress ? (
                        <p style={s.treasuryMissing} role="status">
                          Treasury address unavailable. Set <code style={s.inlineCodeEnv}>SOLANA_TREASURY_ADDRESS</code>{" "}
                          (or <code style={s.inlineCodeEnv}>VITE_SOLANA_TREASURY_ADDRESS</code>) on the server.
                        </p>
                      ) : (
                        <TestReceiveAddresses
                          serverDepositAddress={treasuryAddress}
                          depositAddressError={null}
                          addressReady
                          variant="treasury"
                        />
                      )}
                    </Suspense>
                  </div>
                  <p style={s.depositBuySell}>
                    <a href={CHANGENOW_URL} target="_blank" rel="noopener noreferrer" style={s.buySellLink}>
                      Buy/Sell cryptocurrencies
                    </a>{" "}
                    <span style={{ color: "var(--muted)" }}>— instant swaps via ChangeNOW.</span>
                  </p>
                </>
              ) : null}
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
  err: { margin: "8px 0 0", fontSize: 13, color: "var(--danger)" },
  treasuryMissing: { margin: "8px 0 0", fontSize: 13, lineHeight: 1.5, color: "var(--muted)" },
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
  depositExplainerSecondary: {
    margin: "16px 0 8px",
    fontSize: 13,
    lineHeight: 1.55,
    color: "var(--muted)",
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
  receiveAddressesBlock: { marginTop: 8 },
  suspenseFallback: { fontSize: 13, color: "var(--muted)" },
  buySellLink: { color: "var(--accent)", fontWeight: 600 },
  inlineCodeEnv: {
    fontSize: "0.85em",
    fontWeight: 600,
    color: "var(--muted)",
  },
};
