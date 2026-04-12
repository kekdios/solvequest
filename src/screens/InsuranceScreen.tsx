import type { CSSProperties } from "react";
import {
  uiBtnPrimary,
  uiFieldLabel,
  uiInput,
  uiOrderCard,
  uiPosCard,
  uiSectionH3,
} from "../ui/appSurface";
import type { Account } from "../engine/types";
import type { InsuranceTierId } from "../engine/insuranceTiers";
import { getInsuranceTier } from "../engine/insuranceTiers";
import InsuranceTierPicker from "../components/InsuranceTierPicker";
import { QusdAmount, QusdIcon, QusdWord } from "../Qusd";

type LogEntry = {
  id: string;
  t: number;
  kind: "info" | "loss" | "premium" | "block" | "coverage";
  message: string;
};

type Props = {
  account: Account;
  fmt: (n: number) => string;
  insuranceTierId: InsuranceTierId;
  canChangeInsuranceTier: boolean;
  onSelectInsuranceTier: (tierId: InsuranceTierId) => void;
  depositStr: string;
  setDepositStr: (v: string) => void;
  addStr: string;
  setAddStr: (v: string) => void;
  onReset: () => void;
  onDeposit: () => void;
  onPurchaseCoveragePremium: () => void;
  canPurchaseCoveragePremium: boolean;
  withdrawOk: boolean;
  onWithdrawTry: () => void;
  logPreview: LogEntry[];
};

export default function InsuranceScreen({
  account,
  fmt,
  insuranceTierId,
  canChangeInsuranceTier,
  onSelectInsuranceTier,
  depositStr,
  setDepositStr,
  addStr,
  setAddStr,
  onReset,
  onDeposit,
  onPurchaseCoveragePremium,
  canPurchaseCoveragePremium,
  withdrawOk,
  onWithdrawTry,
  logPreview,
}: Props) {
  const tier = getInsuranceTier(insuranceTierId);
  const covPct =
    account.plan.coverageLimit > 0
      ? Math.min(100, (account.coverageUsed / account.plan.coverageLimit) * 100)
      : 0;
  const remainingCover = Math.max(0, account.plan.coverageLimit - account.coverageUsed);

  return (
    <div className="app-page" style={s.wrap}>
      <section style={s.card}>
        <h3 style={s.h3}>Smart Pool Insurance — choose your tier</h3>
        <p style={{ ...s.hint, marginTop: 0 }}>
          Three options: <strong style={{ color: "var(--text)" }}>1% / 5% / 10%</strong> of winnings to the pool, and{" "}
          <strong style={{ color: "var(--text)" }}>10,000 / 25,000 / 50,000</strong>{" "}
          <QusdWord /> max insured losses (tier caps). When the cap is hit, all open positions close. You can only
          switch tier when you have <em>no</em> open perpetual positions.
        </p>
        <InsuranceTierPicker
          selectedTierId={insuranceTierId}
          canChangeTier={canChangeInsuranceTier}
          onSelectTier={onSelectInsuranceTier}
        />
        <p style={{ ...s.hint, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          <span>
            Active: Tier {tier.id} · {(tier.winningsPct * 100).toFixed(0)}% of wins to pool ·{" "}
            {tier.maxLossCoveredQusd.toLocaleString()}{" "}
          </span>
          <QusdWord size={12} />
          <span>max insured losses</span>
        </p>
      </section>

      <section style={s.hero}>
        <p style={s.eyebrow}>Collective pool narrative</p>
        <h2 style={s.heroTitle}>Coverage runs automatically behind every trade</h2>
        <p style={s.heroLead}>
          Losses draw against your <strong style={{ color: "var(--text)" }}>insured loss cap</strong> (tier-based).
          The pool covers losses up to that cap in QUSD; beyond it you pay from balance. Hit the cap and{" "}
          <strong style={{ color: "var(--warn)" }}>all positions close</strong>. Warnings fire at 10%, 5%, and 1%
          capacity remaining.
        </p>
      </section>

      <section style={s.statGrid}>
        <div style={s.statHero}>
          <p style={s.statLabel}>Losses the pool paid on your behalf</p>
          <div style={s.statHeroValue}>
            <QusdAmount
              value={account.coveredLosses}
              maximumFractionDigits={4}
              strong
              color="var(--ok)"
              iconSize={24}
              amountStyle={{ fontSize: "2rem", fontWeight: 700, letterSpacing: "-0.02em" }}
            />
          </div>
          <p style={s.statSub}>Cumulative QUSD the pool applied toward your losses (toward your cap).</p>
        </div>
        <div style={s.statCard}>
          <p style={s.statLabel}>Your share to the collective pool</p>
          <div style={s.statValue}>
            <QusdAmount value={account.premiumAccrued} maximumFractionDigits={4} strong />
          </div>
          <p style={s.statSub}>
            Win skim to the pool plus any 1 USDC cap-extension premiums you bought.
          </p>
        </div>
        <div style={s.statCard}>
          <p style={s.statLabel}>Remaining insured capacity</p>
          <div style={s.statValue}>
            <QusdAmount value={remainingCover} maximumFractionDigits={2} strong color="var(--accent)" />
          </div>
          <p style={s.statSub}>Headroom before max insured losses are exhausted (then all positions close).</p>
        </div>
      </section>

      <section style={s.card}>
        <h3 style={s.h3}>Insured loss usage</h3>
        <div style={s.meter}>
          <div style={{ ...s.meterFill, width: `${covPct}%` }} />
        </div>
        <p style={{ ...s.meterCap, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <QusdIcon size={16} />
          <span className="mono">
            {fmt(account.coverageUsed)} / {fmt(account.plan.coverageLimit)} QUSD insured losses absorbed
          </span>
        </p>
        <p style={s.hint}>
          At 100% of your cap, every open perpetual is closed at market. You&apos;ll see warnings at 10%, 5%, and
          1% capacity left.
        </p>
      </section>

      <section style={s.card}>
        <h3 style={s.h3}>Extend max cover (premium)</h3>
        <p style={s.hint}>
          Pay <strong style={{ color: "var(--text)" }}>1 USDC</strong> to add{" "}
          <strong style={{ color: "var(--text)" }}>200 QUSD</strong> to your max insured loss allowance (stackable).
        </p>
        <button
          type="button"
          style={s.btn}
          disabled={!canPurchaseCoveragePremium}
          onClick={onPurchaseCoveragePremium}
        >
          Pay 1 USDC · +200 QUSD cap
        </button>
      </section>

      <section style={s.card}>
        <h3 style={s.h3}>Session</h3>
        <div style={s.row}>
          <label>
            Initial deposit (USDC){" "}
            <input
              value={depositStr}
              onChange={(e) => setDepositStr(e.target.value)}
              style={s.input}
              className="mono"
            />
          </label>
          <button type="button" style={s.btn} onClick={onReset}>
            Reset session
          </button>
        </div>
        <div style={{ ...s.row, marginTop: 12 }}>
          <label>
            Top-up{" "}
            <input value={addStr} onChange={(e) => setAddStr(e.target.value)} style={s.input} className="mono" />
          </label>
          <button type="button" style={s.btn} onClick={onDeposit}>
            Deposit
          </button>
        </div>
      </section>

      <section style={s.card}>
        <h3 style={s.h3}>Withdrawal probe (demo)</h3>
        <div style={s.row}>
          <button type="button" style={s.btnWarn} onClick={onWithdrawTry}>
            Try withdraw
          </button>
          <span style={{ color: withdrawOk ? "var(--ok)" : "var(--danger)", fontSize: 14 }}>
            {withdrawOk ? "Allowed (demo withdraw probe)" : "Blocked"}
          </span>
        </div>
      </section>

      <section style={s.card}>
        <h3 style={s.h3}>Recent pool activity</h3>
        <p style={s.hint}>Win contributions, any equity premiums, and perp-linked pool claims—newest first.</p>
        <div style={s.log}>
          {logPreview.map((e) => (
            <div key={e.id} className="app-page-log-row" style={logRow(e.kind)}>
              <span className="mono" style={{ color: "var(--muted)", flexShrink: 0 }}>
                {new Date(e.t).toLocaleTimeString()}
              </span>
              <span>{e.message}</span>
            </div>
          ))}
          {logPreview.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>No events yet.</div>}
        </div>
      </section>
    </div>
  );
}

function logRow(kind: LogEntry["kind"]): CSSProperties {
  const color =
    kind === "loss"
      ? "var(--warn)"
      : kind === "block"
        ? "var(--danger)"
        : kind === "premium"
          ? "var(--accent)"
          : kind === "coverage"
            ? "var(--ok)"
            : "var(--text)";
  return {
    display: "flex",
    gap: 12,
    padding: "6px 0",
    borderBottom: "1px solid var(--border)",
    fontSize: 12,
    color,
  };
}

const s: Record<string, CSSProperties> = {
  wrap: { display: "flex", flexDirection: "column", gap: 16 },
  hero: {
    background: "color-mix(in srgb, var(--accent) 7%, var(--surface))",
    border: "1px solid color-mix(in srgb, var(--accent) 28%, var(--border))",
    borderRadius: 12,
    padding: "22px 20px",
    boxShadow:
      "inset 0 1px 0 color-mix(in srgb, var(--text) 5%, transparent), 0 6px 28px color-mix(in srgb, var(--accent) 8%, transparent)",
  },
  eyebrow: {
    margin: "0 0 8px",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: "var(--accent)",
  },
  heroTitle: { margin: "0 0 12px", fontSize: "1.35rem", fontWeight: 700, letterSpacing: "-0.02em" },
  heroLead: {
    margin: "0 0 12px",
    fontSize: 14,
    lineHeight: 1.65,
    color: "var(--muted)",
  },
  statGrid: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 12,
  },
  statHero: {
    background: "linear-gradient(145deg, #141416, var(--panel))",
    border: "1px solid color-mix(in srgb, var(--accent) 32%, var(--border))",
    borderRadius: 12,
    padding: "22px 20px",
    boxShadow:
      "inset 0 1px 0 color-mix(in srgb, var(--text) 5%, transparent), 0 4px 24px color-mix(in srgb, var(--text) 5%, transparent)",
  },
  statCard: {
    ...uiPosCard,
  },
  statLabel: {
    margin: "0 0 8px",
    ...uiFieldLabel,
  },
  statHeroValue: {
    margin: "0 0 8px",
    fontSize: "2rem",
    fontWeight: 700,
    color: "var(--ok)",
    letterSpacing: "-0.02em",
  },
  statValue: { margin: "0 0 8px", fontSize: "1.25rem", fontWeight: 650, color: "var(--text)" },
  statSub: { margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--muted)" },
  card: {
    ...uiOrderCard,
  },
  h3: { ...uiSectionH3 },
  meter: {
    height: 10,
    borderRadius: 999,
    background: "var(--bg)",
    overflow: "hidden",
    border: "1px solid var(--border)",
  },
  meterFill: {
    height: "100%",
    background: "linear-gradient(90deg, color-mix(in srgb, var(--accent) 70%, #000), var(--accent))",
    borderRadius: 999,
    transition: "width 0.3s ease",
  },
  meterCap: { margin: "10px 0 0", fontSize: 13, color: "var(--muted)" },
  hint: { margin: "10px 0 0", fontSize: 12, color: "var(--muted)", lineHeight: 1.5 },
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 },
  input: {
    ...uiInput,
    padding: "8px 10px",
    minWidth: 120,
  },
  btn: {
    ...uiBtnPrimary,
  },
  btnWarn: {
    background: "color-mix(in srgb, var(--warn) 14%, var(--panel))",
    border: "1px solid color-mix(in srgb, var(--warn) 38%, var(--border))",
    color: "#fde68a",
    borderRadius: 8,
    padding: "10px 16px",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
    fontFamily: "inherit",
    boxShadow:
      "0 0 0 1px color-mix(in srgb, var(--warn) 12%, transparent), 0 4px 18px color-mix(in srgb, var(--warn) 10%, transparent)",
  },
  log: {
    maxHeight: 220,
    overflow: "auto",
    fontFamily: "var(--mono)",
  },
};
