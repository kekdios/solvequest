import type { CSSProperties } from "react";

export type PrizeAwardApiRow = {
  award_day_est: string;
  awarded_at: number;
  prize_amount: number;
  winner_label: string;
};

const box: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "16px 18px",
  marginTop: 20,
  maxWidth: 640,
  background: "var(--panel)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  padding: "8px 0",
  borderBottom: "1px solid color-mix(in srgb, var(--border) 80%, transparent)",
  fontSize: 14,
};

type Props = {
  rows: PrizeAwardApiRow[];
  title?: string;
  /** Short explainer shown under the title */
  processNote?: string;
};

function fmtWhen(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function PrizeAwardRoll({ rows, title = "Recent daily prize winners", processNote }: Props) {
  if (rows.length === 0) {
    return (
      <section style={box} aria-label={title}>
        <h2 style={h2}>{title}</h2>
        {processNote ? (
          <p style={noteP}>{processNote}</p>
        ) : null}
        <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--muted)" }}>
          No awards recorded yet. Winners appear here after each run.
        </p>
      </section>
    );
  }

  return (
    <section style={box} aria-label={title}>
      <h2 style={h2}>{title}</h2>
      {processNote ? (
        <p style={noteP}>{processNote}</p>
      ) : null}
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {rows.map((r) => (
          <li key={`${r.award_day_est}-${r.awarded_at}`} style={rowStyle}>
            <span aria-hidden style={{ fontSize: "1.25rem", lineHeight: 1 }}>
              🏆
            </span>
            <span style={{ fontWeight: 650, color: "var(--ok)", letterSpacing: "-0.02em" }} className="mono">
              {r.winner_label}
            </span>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              {r.prize_amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} QUSD
            </span>
            <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: "auto" }}>{fmtWhen(r.awarded_at)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const h2: CSSProperties = {
  margin: "0 0 10px",
  fontSize: "1rem",
  fontWeight: 700,
  letterSpacing: "-0.02em",
  color: "var(--text)",
};

const noteP: CSSProperties = {
  margin: "0 0 12px",
  fontSize: 13,
  lineHeight: 1.55,
  color: "var(--muted)",
  maxWidth: 560,
};
