import { useEffect, useState, type CSSProperties } from "react";
import { QusdIcon } from "../Qusd";

const USDC_ICON = "/prize-usdc.png";
const QUEST_ICON = "/prize-quest.png";

type SellConfig = {
  prize_amount: number;
  claim_quest_amount: number;
  quest_multiplier: number;
};

type LbRow = {
  rank: number;
  account_id: string;
  label: string;
  qusd: number;
  is_you: boolean;
};

export default function LeaderboardScreen() {
  const [config, setConfig] = useState<SellConfig | null>(null);
  const [rows, setRows] = useState<LbRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch("/api/qusd/sell/config", { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/leaderboard?limit=50", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(([cfg, lb]) => {
      if (cancelled) return;
      if (cfg && typeof cfg === "object" && "prize_amount" in cfg) {
        setConfig(cfg as SellConfig);
      }
      const list =
        lb && typeof lb === "object" && Array.isArray((lb as { rows?: unknown }).rows)
          ? ((lb as { rows: LbRow[] }).rows ?? [])
          : [];
      setRows(list);
      setLoadErr(cfg == null && lb == null ? "Could not load prize info or leaderboard." : null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const prizeAmount = config?.prize_amount ?? 0;
  const claimAmt = config?.claim_quest_amount ?? 0;
  const mult = config?.quest_multiplier ?? 1000;

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
        . Spend{" "}
        <span style={{ whiteSpace: "nowrap" }}>
          <QusdIcon size={16} />
          <strong> QUSD</strong>
        </span>{" "}
        to receive QUEST at <strong>{mult.toLocaleString()} QUSD per 1 QUEST</strong>.
      </p>

      <h2 style={s.h2}>Top players by QUSD</h2>
      <p style={s.lead}>Rankings use total QUSD balance (ledger). Emails are masked for privacy.</p>

      {rows.length === 0 && !loadErr ? (
        <p style={{ color: "var(--muted)", marginTop: 12 }}>No balances to show yet.</p>
      ) : (
        <div className="app-table-scroll" style={{ marginTop: 12 }}>
          <table className="data-table" style={{ width: "100%", minWidth: 280, fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ width: 56 }}>#</th>
                <th>Player</th>
                <th style={{ textAlign: "right" }}>QUSD</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.account_id}
                  style={
                    r.is_you
                      ? { background: "color-mix(in srgb, var(--accent) 10%, transparent)" }
                      : undefined
                  }
                >
                  <td className="mono">{r.rank}</td>
                  <td style={{ wordBreak: "break-word" }}>
                    {r.label}
                    {r.is_you ? (
                      <span style={{ marginLeft: 8, fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>
                        (you)
                      </span>
                    ) : null}
                  </td>
                  <td className="mono" style={{ textAlign: "right" }}>
                    {r.qusd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  h2: {
    margin: "28px 0 0",
    fontSize: "1.1rem",
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: "var(--text)",
  },
  lead: {
    margin: "8px 0 0",
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--muted)",
    maxWidth: 560,
  },
};
