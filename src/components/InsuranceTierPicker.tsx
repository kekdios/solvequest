import type { CSSProperties } from "react";
import type { InsuranceTierId } from "../engine/insuranceTiers";
import { INSURANCE_TIERS } from "../engine/insuranceTiers";
import { QusdIcon } from "../Qusd";

type Props = {
  selectedTierId: InsuranceTierId;
  canChangeTier: boolean;
  onSelectTier: (id: InsuranceTierId) => void;
  /** Tighter layout for perps strip */
  compact?: boolean;
};

export default function InsuranceTierPicker({
  selectedTierId,
  canChangeTier,
  onSelectTier,
  compact,
}: Props) {
  return (
    <div style={compact ? s.wrapCompact : s.wrap}>
      {!canChangeTier && (
        <p style={s.locked}>
          Tier is locked while you have open positions. Close all positions to change Smart Pool Insurance.
        </p>
      )}
      <div style={s.grid}>
        {INSURANCE_TIERS.map((t) => {
          const on = selectedTierId === t.id;
          const lockedDim = !canChangeTier && !on;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                if (canChangeTier) onSelectTier(t.id);
              }}
              style={{
                ...s.card,
                ...(on ? s.cardOn : {}),
                ...(lockedDim ? s.cardDisabled : {}),
                cursor: canChangeTier ? "pointer" : "default",
              }}
            >
              <span style={s.tierName}>Tier {t.id}</span>
              <span style={s.line}>
                <strong>{(t.winningsPct * 100).toFixed(0)}%</strong> of winnings to pool
              </span>
              <span style={s.lineMuted}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <QusdIcon size={12} />
                  {t.maxLossCoveredQusd.toLocaleString()} QUSD max insured losses
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  wrap: { marginTop: 14 },
  wrapCompact: { marginTop: 0 },
  locked: {
    margin: "0 0 12px",
    fontSize: 12,
    color: "var(--warn)",
    lineHeight: 1.45,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))",
    gap: 10,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 6,
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--text)",
    textAlign: "left",
    cursor: "pointer",
    font: "inherit",
  },
  cardOn: {
    borderColor: "color-mix(in srgb, var(--accent) 45%, var(--border))",
    background: "color-mix(in srgb, var(--accent) 10%, var(--panel))",
    boxShadow: "0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent)",
  },
  cardDisabled: {
    opacity: 0.55,
    cursor: "not-allowed",
  },
  tierName: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--muted)",
  },
  line: { fontSize: 13, lineHeight: 1.4 },
  lineMuted: { fontSize: 11, color: "var(--muted)", lineHeight: 1.35 },
};
