import { useEffect, useState, type CSSProperties } from "react";
const QUSD_ICON = "/icon-qusd.png";

type PrizeConfig = {
  prize_amount: number;
};

type LbRow = {
  rank: number;
  account_id: string;
  label: string;
  qusd: number;
  is_you: boolean;
  prize_eligible: boolean;
  prize_rank: number | null;
};

export default function LeaderboardScreen() {
  const [config, setConfig] = useState<PrizeConfig | null>(null);
  const [rows, setRows] = useState<LbRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch("/api/prize/config", { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/leaderboard?limit=50", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(([cfg, lb]) => {
      if (cancelled) return;
      if (cfg && typeof cfg === "object" && "prize_amount" in cfg) {
        setConfig(cfg as PrizeConfig);
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

  return (
    <div>
      {loadErr ? (
        <p role="alert" style={{ color: "var(--danger)" }}>
          {loadErr}
        </p>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
        <img src={QUSD_ICON} alt="" width={40} height={40} style={{ objectFit: "contain" }} />
        <span style={{ fontSize: "1.75rem", fontWeight: 700, letterSpacing: "-0.03em" }}>
          {prizeAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} QUSD
        </span>
        <span style={{ color: "var(--muted)", fontSize: 14 }}>daily prize pool</span>
      </div>

      <p style={{ marginTop: 18, lineHeight: 1.6, maxWidth: 640 }}>
        You compete for this QUSD amount <strong>daily</strong> per the <strong>Prize</strong> page —{" "}
        <strong>one daily prize win per account</strong> (lifetime). Rankings below are total QUSD (ledger). The{" "}
        <strong>Prize #</strong> column is your standing among traders still eligible for that prize. To convert trading
        profits to real <strong>USDC</strong>, use <strong>Swap</strong> after you verify your Solana address.
      </p>

      <h2 style={s.h2}>Top players by QUSD</h2>
      <p style={s.lead}>
        Overall # is leaderboard order. Prize # applies only if you have not already won the daily prize. Players show
        as <strong>cool usernames</strong> (set when you verify email); older rows may still show a masked email until
        you load the app once signed in.
      </p>

      {rows.length === 0 && !loadErr ? (
        <p style={{ color: "var(--muted)", marginTop: 12 }}>No balances to show yet.</p>
      ) : (
        <div className="app-table-scroll" style={{ marginTop: 12 }}>
          <table className="data-table" style={{ width: "100%", minWidth: 280, fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ width: 48 }}>#</th>
                <th style={{ width: 64 }} title="Rank among prize-eligible traders (— if you already won)">
                  Prize #
                </th>
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
                  <td className="mono" style={{ color: r.prize_eligible ? "var(--text)" : "var(--muted)" }}>
                    {r.prize_rank != null ? r.prize_rank : "—"}
                  </td>
                  <td style={{ wordBreak: "break-word" }}>
                    {r.label}
                    {r.is_you ? (
                      <span style={{ marginLeft: 8, fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>
                        (you)
                      </span>
                    ) : null}
                    {!r.prize_eligible ? (
                      <span style={{ marginLeft: 6, fontSize: 11, color: "var(--muted)" }} title="Already won daily prize">
                        (won)
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
