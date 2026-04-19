/**
 * Landing copy revised 2026-04-14. Rollback: copy `docs/landing-rollback-2026-04-14/LandingPage.tsx` →
 * `src/screens/LandingPage.tsx` and `landing.css` → `src/screens/landing.css`.
 */
import { useEffect, useState } from "react";
import "./landing.css";

type Props = {
  onStartNow: () => void;
  /** Navigate to Prize (sell QUSD) screen — used for in-app links from the landing copy. */
  onGoToPrize?: () => void;
  /** Cursor AI prompt page (not in sidebar). */
  onGoToAgentPuzzle?: () => void;
  onTerms?: () => void;
  onPrivacy?: () => void;
};

function IconChart({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 18V6M8 18v-5M12 18V9M16 18v-8M20 18v-3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconSpark({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconAutomation({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.26 0 .51.05.75.15H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type LeaderboardPreviewRow = {
  rank: number;
  label: string;
  qusd: number;
};

type LandingStats = {
  closes_24h: number | null;
  accounts_with_email: number | null;
};

type PrizeConfigResponse = {
  prize_amount?: number;
  next_award_at_ms?: number;
  award_schedule_label?: string;
};

function PrizeCountdown({ atMs, scheduleLabel }: { atMs: number | null; scheduleLabel: string }) {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (atMs == null || !Number.isFinite(atMs)) return null;
  const sec = Math.max(0, Math.floor((atMs - tick) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <p className="lp-prize-countdown" role="status" aria-live="polite">
      Next scheduled award: <strong className="mono">{pad(h)}</strong>h <strong className="mono">{pad(m)}</strong>m{" "}
      <strong className="mono">{pad(s)}</strong>s · {scheduleLabel}
    </p>
  );
}

export default function LandingPage({ onStartNow, onGoToPrize, onGoToAgentPuzzle, onTerms, onPrivacy }: Props) {
  const [prizeAmount, setPrizeAmount] = useState<number | null | undefined>(undefined);
  const [nextAwardAtMs, setNextAwardAtMs] = useState<number | null>(null);
  const [awardScheduleLabel, setAwardScheduleLabel] = useState("4:00 PM US Eastern Time");
  const [lbRows, setLbRows] = useState<LeaderboardPreviewRow[]>([]);
  const [lbLoading, setLbLoading] = useState(true);
  const [stats, setStats] = useState<LandingStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch("/api/prize/config", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/leaderboard?limit=3", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/landing-stats", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([cfg, lb, st]) => {
        if (cancelled) return;
        if (cfg && typeof cfg === "object" && "prize_amount" in cfg) {
          const c = cfg as PrizeConfigResponse;
          const n = c.prize_amount;
          setPrizeAmount(typeof n === "number" && Number.isFinite(n) ? n : null);
          const na = c.next_award_at_ms;
          setNextAwardAtMs(typeof na === "number" && Number.isFinite(na) ? na : null);
          if (typeof c.award_schedule_label === "string" && c.award_schedule_label.trim()) {
            setAwardScheduleLabel(c.award_schedule_label.trim());
          }
        } else {
          setPrizeAmount(null);
          setNextAwardAtMs(null);
        }
        const rows =
          lb && typeof lb === "object" && Array.isArray((lb as { rows?: unknown }).rows)
            ? ((lb as { rows: LeaderboardPreviewRow[] }).rows ?? [])
            : [];
        setLbRows(rows.slice(0, 3));
        setLbLoading(false);
        if (st && typeof st === "object") {
          setStats({
            closes_24h: typeof (st as LandingStats).closes_24h === "number" ? (st as LandingStats).closes_24h : null,
            accounts_with_email:
              typeof (st as LandingStats).accounts_with_email === "number"
                ? (st as LandingStats).accounts_with_email
                : null,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPrizeAmount(null);
          setNextAwardAtMs(null);
          setLbRows([]);
          setLbLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const prizePart =
    prizeAmount === undefined
      ? "…"
      : prizeAmount === null
        ? "—"
        : prizeAmount.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div className="lp">
      <section className="lp-hero" aria-labelledby="lp-hero-heading">
        <div className="lp-hero-inner">
          <h1 id="lp-hero-heading" className="lp-title lp-title--game">
            Be the #1 trader and win{" "}
            <span className="lp-hero-prize-inline">
              <img src="/icon-qusd.png" alt="" width={28} height={28} className="lp-hero-prize-icon" />
              <span className="lp-hero-prize-amount">{prizePart} QUSD</span>
            </span>{" "}
            every day
          </h1>
          <p className="lp-hero-lead">
            Compete on the live leaderboard. <strong>One winner</strong> per Eastern day gets the full QUSD pool as a{" "}
            <strong>QUSD ledger credit only</strong> — not USDC — until they (or any user) choose to swap. The automatic
            award runs at <strong>4:00&nbsp;PM US Eastern Time</strong> for the #1 <strong>prize-eligible</strong> trader.{" "}
            <strong>No splitting.</strong>
          </p>
          <div
            className="lp-hero-swap-highlight"
            role="region"
            aria-label="Swap QUSD to Solana USDC using the in-app Swap feature"
          >
            <p className="lp-hero-swap-highlight-main">
              Swap{" "}
              <span className="lp-hero-swap-highlight-tokens">
                <img src="/icon-qusd.png" alt="" width={26} height={26} className="lp-hero-swap-highlight-qusd" />
                QUSD
              </span>{" "}
              for{" "}
              <span className="lp-hero-swap-highlight-tokens lp-hero-swap-highlight-tokens--usdc">
                <img src="/prize-usdc.png" alt="" width={24} height={24} className="lp-hero-swap-usdc-icon" />
                USDC
              </span>
              <a
                href="#lp-swap-footnote"
                className="lp-hero-swap-asterisk"
                aria-label="See footnote: Swap, verified receive address, minimum QUSD floor"
              >
                {" "}
                *
              </a>
            </p>
          </div>
          <p className="lp-hero-nodeposit">
            Performance-based — trade, rank, and win. No random draw. No deposit required to start.
          </p>

          <div className="lp-hero-aside">
            <figure className="lp-hero-media">
              <img
                src="/trade-gif.gif"
                alt="Recording of the Solve Quest trade screen with charts and order controls"
                className="lp-hero-gif"
                width={960}
                height={540}
                loading="eager"
                decoding="async"
              />
              <figcaption className="lp-hero-media-caption">
                In-app terminal preview — index marks from Hyperliquid.
              </figcaption>
            </figure>
            <p className="lp-trust-strip">
              <span className="lp-trust-kicker">Attribution</span>
              <span className="lp-trust-line">
                Index prices:{" "}
                <a href="https://hyperliquid.xyz/" target="_blank" rel="noopener noreferrer">
                  Hyperliquid
                </a>
                . Deposits and on-chain USDC settle to your verified receive address (see Account).
              </span>
            </p>
          </div>

          <p className="lp-sub lp-sub--hero">
            Trading is in-app on QUSD; marks reference Hyperliquid. Swap moves QUSD ↔ Solana USDC when you initiate it.
          </p>
          <ul className="lp-hero-pills" aria-label="What you get">
            <li className="lp-hero-pill">
              <img src="/icon-qusd.png" alt="" width={20} height={20} />
              <span>
                <strong>30,000 QUSD</strong> bonus when fully verified
              </span>
            </li>
            <li className="lp-hero-pill">
              <IconChart />
              <span>Live leaderboard</span>
            </li>
            <li className="lp-hero-pill">
              <img src="/icon-qusd.png" alt="" width={20} height={20} />
              <span>
                <strong>One daily winner</strong> — full QUSD pool
              </span>
            </li>
            <li className="lp-hero-pill lp-hero-pill--swap">
              <img src="/prize-usdc.png" alt="" width={20} height={20} />
              <span>
                <strong>Swap</strong> QUSD → Solana USDC
              </span>
            </li>
          </ul>
          <div className="lp-cta-stack">
            <button type="button" className="lp-btn-primary" onClick={onStartNow}>
              Start trading
            </button>
            <p className="lp-cta-hint">Email verification takes ~10 seconds.</p>
          </div>
        </div>
      </section>

      <section className="lp-section lp-daily-prize-card" aria-labelledby="lp-daily-prize-heading">
        <h2 id="lp-daily-prize-heading" className="lp-section-title lp-daily-prize-title-with-icon">
          <img src="/icon-qusd.png" alt="" width={36} height={36} className="lp-daily-prize-title-icon" />
          <span>Daily QUSD prize</span>
        </h2>
        <p className="lp-section-lead lp-daily-prize-lead">
          <strong className="lp-daily-prize-strong">{prizePart} QUSD</strong> (live configuration) awarded each US Eastern
          calendar day to the <strong>#1 prize-eligible trader</strong>. The prize is a <strong>pure QUSD accounting entry</strong>{" "}
          on our ledger — you stay in QUSD on the platform until you optionally convert.
        </p>
        <PrizeCountdown atMs={nextAwardAtMs} scheduleLabel={awardScheduleLabel} />
        <div className="lp-daily-prize-how">
          <p className="lp-daily-prize-how-title">How it works</p>
          <ol className="lp-numbered-list">
            <li>Trade in the app — closed trades update your QUSD balance.</li>
            <li>
              Climb the real-time leaderboard. When the award runs at <strong>4:00&nbsp;PM US Eastern Time</strong>, the
              top <strong>prize-eligible</strong> trader wins (see{" "}
              {onGoToPrize ? (
                <button type="button" className="lp-text-link" onClick={onGoToPrize}>
                  Prize
                </button>
              ) : (
                "Prize"
              )}
              ).
            </li>
            <li>
              The winner&apos;s account is credited with <strong>{prizePart} QUSD</strong> — still QUSD, not automatic
              USDC. The platform does <strong>not</strong> convert the prize to USDC for you.
            </li>
          </ol>
        </div>
        <p className="lp-daily-prize-cashout">
          <strong>Turning QUSD into USDC</strong> — use the{" "}
          <a href="#lp-swap-instructions" className="lp-text-link">
            Swap page
          </a>{" "}
          to exchange QUSD for <strong>Solana SPL USDC</strong> at the rate shown there, after you verify your Solana
          address on <strong>Account</strong>.
        </p>
        <p className="lp-daily-prize-rules-cta">
          <a href="#lp-daily-prize-rules" className="lp-btn-secondary">
            Read the full prize rules
          </a>
        </p>
        {onGoToAgentPuzzle ? (
          <p className="lp-daily-prize-agent-link">
            <strong>Build with Cursor</strong> — a Composer-ready prompt to generate a SolveQuest-themed Tetris prototype
            (single HTML file; not on the main menu).{" "}
            <button type="button" className="lp-text-link" onClick={onGoToAgentPuzzle}>
              Open prompt page
            </button>
            .
          </p>
        ) : null}
      </section>

      <section className="lp-section lp-leader-preview" aria-labelledby="lp-lb-heading">
        <h2 id="lp-lb-heading" className="lp-section-title">
          Top traders right now
        </h2>
        <p className="lp-section-lead lp-section-lead--tight">
          Real QUSD balances from our server leaderboard (cool usernames after email verification).
        </p>
        <div className="lp-table-scroll">
          <table className="lp-mini-table">
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Trader</th>
                <th scope="col" className="lp-mini-table-num">
                  QUSD balance
                </th>
              </tr>
            </thead>
            <tbody>
              {lbLoading ? (
                <tr>
                  <td colSpan={3} className="lp-mini-table-muted">
                    Loading…
                  </td>
                </tr>
              ) : lbRows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="lp-mini-table-muted">
                    Be the first on the board — start trading to appear here.
                  </td>
                </tr>
              ) : (
                lbRows.map((r) => (
                  <tr key={`${r.rank}-${r.label}`}>
                    <td className="mono">#{r.rank}</td>
                    <td>{r.label}</td>
                    <td className="mono lp-mini-table-num">
                      {r.qusd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="lp-leader-cta">
          <button type="button" className="lp-text-link lp-leader-cta-btn" onClick={onStartNow}>
            Think you can beat them? Start trading.
          </button>
        </p>
      </section>

      <section className="lp-section lp-example" aria-labelledby="lp-ex-heading">
        <h2 id="lp-ex-heading" className="lp-section-title">
          Example trade
        </h2>
        <p className="lp-section-lead lp-section-lead--tight">Illustrative — not investment advice.</p>
        <div className="lp-example-card">
          <div className="lp-example-head">
            <span className="lp-example-pair">BTC · Long</span>
            <span className="lp-example-badge">Demo math</span>
          </div>
          <dl className="lp-example-dl">
            <div>
              <dt>Entry</dt>
              <dd className="mono">63,200</dd>
            </div>
            <div>
              <dt>Exit</dt>
              <dd className="mono">65,000</dd>
            </div>
            <div className="lp-example-profit">
              <dt>Profit (illustrative)</dt>
              <dd className="mono">+1,320 QUSD</dd>
            </div>
          </dl>
          <p className="lp-example-note">
            Positions use fixed leverage; PnL depends on index movement and margin. See <strong>Trade</strong> for live
            prices.
          </p>
        </div>
      </section>

      <section className="lp-section lp-prize-faq" aria-labelledby="lp-faq-heading">
        <h2 id="lp-faq-heading" className="lp-section-title">
          Daily prize, QUSD &amp; USDC
        </h2>
        <p className="lp-section-lead lp-section-lead--tight">
          Short answers — timing and eligibility match the{" "}
          <a href="#lp-daily-prize-rules" className="lp-text-link">
            full prize rules
          </a>{" "}
          below and the{" "}
          {onGoToPrize ? (
            <button type="button" className="lp-text-link" onClick={onGoToPrize}>
              Prize
            </button>
          ) : (
            "Prize"
          )}{" "}
          screen in the app.
        </p>
        <div className="lp-faq-list">
          <details className="lp-faq-item">
            <summary>What is QUSD vs real USDC?</summary>
            <p>
              <strong>QUSD</strong> is your in-app balance for perpetual-style trading: margin and closed-trade PnL
              settle in QUSD. The <strong>daily prize</strong> is a <strong>QUSD ledger credit only</strong> to one
              eligible winner per Eastern day — it is <strong>not</strong> auto-paid as USDC. <strong>USDC</strong> is
              on-chain <strong>Solana SPL</strong>: use <strong>Swap</strong> when you want to convert QUSD at the
              published rate (subject to the QUSD floor on Swap) to your verified Solana address.
            </p>
          </details>
          <details className="lp-faq-item">
            <summary>Does trading run on Solana?</summary>
            <p>
              <strong>No.</strong> Perpetual-style trading in the app uses your <strong>QUSD</strong> balance and
              Hyperliquid-derived <strong>index marks</strong> for reference prices. <strong>Solana</strong> is used for
              optional on-chain flows: <strong>Swap</strong> (QUSD ↔ USDC) and optional <strong>USDC deposits</strong> that
              credit QUSD after verification.
            </p>
          </details>
          <details className="lp-faq-item">
            <summary>How do the daily prize and trading profits fit together?</summary>
            <p>
              You <strong>trade</strong> to grow QUSD, then <strong>rank</strong> on the leaderboard. The daily award goes
              to the <strong>#1 prize-eligible</strong> trader (see Leaderboard) when the server runs the scheduled award (
              <strong>4:00&nbsp;PM US Eastern</strong>). <strong>Swap</strong> is how you move QUSD to USDC on your own
              schedule, subject to app limits.
            </p>
          </details>
          <details className="lp-faq-item">
            <summary>How do I get USDC?</summary>
            <p>
              Use <strong>Swap</strong> after you verify a receive address on <strong>Account</strong>. Per-swap QUSD
              minimums, rates, and treasury availability apply. The daily prize is paid in QUSD, not USDC.
            </p>
          </details>
          <details className="lp-faq-item">
            <summary>Do I need to deposit money to start?</summary>
            <p>
              No — you can begin with promotional QUSD after email verification. Optional funding via on-chain deposits
              to your verified address is only if you choose; the core loop is QUSD trading first.
            </p>
          </details>
        </div>
      </section>

      <section className="lp-section" aria-labelledby="lp-how-heading">
        <h2 id="lp-how-heading" className="lp-section-title">
          How it works
        </h2>
        <p className="lp-section-lead">
          Three steps from sign-up to execution—without watching charts all day.
        </p>
        <div className="lp-grid-3">
          <article className="lp-card">
            <span className="lp-step-num" aria-hidden>
              1
            </span>
            <h3>Verify email and receive address</h3>
            <p>Sign in with email (OTP), then verify your receive address on Account for deposits, prizes, and Swap.</p>
          </article>
          <article className="lp-card">
            <span className="lp-step-num" aria-hidden>
              2
            </span>
            <h3>Choose direction</h3>
            <div className="lp-dir">
              <span>
                <span className="lp-tag-long">Long</span> if you think price will rise
              </span>
              <span>
                <span className="lp-tag-short">Short</span> if you think price will fall
              </span>
            </div>
          </article>
          <article className="lp-card">
            <span className="lp-step-num" aria-hidden>
              3
            </span>
            <h3 className="lp-step3-heading">
              Trade, aim for #1 among prize-eligible traders, swap to USDC when ready{" "}
              <span className="lp-step3-sub">
                (
                {onGoToPrize ? (
                  <button type="button" className="lp-text-link" onClick={onGoToPrize}>
                    Prize
                  </button>
                ) : (
                  "Prize"
                )}{" "}
                for timing; <strong>Swap</strong> for QUSD → USDC)
              </span>
            </h3>
          </article>
        </div>
      </section>

      <div className="lp-divider" aria-hidden />

      <section className="lp-section" aria-labelledby="lp-why-heading">
        <h2 id="lp-why-heading" className="lp-section-title">
          Why players choose us
        </h2>
        <div className="lp-grid-2">
          <div className="lp-feature">
            <span className="lp-feature-icon" aria-hidden>
              <IconChart />
            </span>
            <div>
              <h3>Real market data</h3>
              <p>
                Index marks from{" "}
                <a href="https://hyperliquid.xyz/" target="_blank" rel="noopener noreferrer" className="lp-inline-link">
                  Hyperliquid
                </a>{" "}
                — same reference prices as in the trade terminal.
              </p>
            </div>
          </div>
          <div className="lp-feature">
            <span className="lp-feature-icon" aria-hidden>
              <IconSpark />
            </span>
            <div>
              <h3>No experience required</h3>
              <p>Beginner-friendly—no advanced trading knowledge required.</p>
            </div>
          </div>
          <div className="lp-feature lp-feature--wide">
            <span className="lp-feature-icon" aria-hidden>
              <IconAutomation />
            </span>
            <div>
              <h3>Automation proof</h3>
              <p>Designed to help keep the field level for everyone.</p>
            </div>
          </div>
        </div>
      </section>

      {stats && (stats.closes_24h != null || stats.accounts_with_email != null) ? (
        <section className="lp-section lp-activity" aria-label="Recent activity">
          <div className="lp-stats">
            {stats.closes_24h != null ? (
              <div className="lp-stat">
                <div className="lp-stat-value">{stats.closes_24h.toLocaleString()}</div>
                <div className="lp-stat-label">Closed trades (last 24h)</div>
              </div>
            ) : null}
            {stats.accounts_with_email != null ? (
              <div className="lp-stat">
                <div className="lp-stat-value">{stats.accounts_with_email.toLocaleString()}</div>
                <div className="lp-stat-label">Registered emails</div>
              </div>
            ) : null}
            <div className="lp-stat">
              <div className="lp-stat-value">HL</div>
              <div className="lp-stat-label">Index marks from Hyperliquid</div>
            </div>
          </div>
        </section>
      ) : null}

      <section
        className="lp-section lp-swap-instructions"
        id="lp-swap-instructions"
        aria-labelledby="lp-swap-instructions-heading"
      >
        <h2 id="lp-swap-instructions-heading" className="lp-section-title">
          Swap QUSD → Solana USDC
        </h2>
        <p className="lp-section-lead lp-section-lead--tight">
          Optional — same flow for prize winnings, trading profits, or other QUSD. Trading itself stays in-app; this step
          is where Solana on-chain USDC is used.
        </p>
        <ol className="lp-numbered-list">
          <li>
            Verify your <strong>Solana wallet address</strong> on the <strong>Account</strong> page (in-app verification).
          </li>
          <li>
            Open <strong>Swap</strong> from the sidebar.
          </li>
          <li>
            Review the <strong>QUSD → USDC rate</strong> shown on the page (operator-configured for this deployment — not a
            Hyperliquid order-book price).
          </li>
          <li>
            Under <strong>Swap QUSD to USDC</strong>, enter the amount to convert (only QUSD above the app minimum
            converts at that rate).
          </li>
          <li>
            Confirm the swap — USDC is a <strong>Solana SPL</strong> token and is sent to your verified wallet after the
            transfer confirms (typically shortly; depends on network conditions).
          </li>
        </ol>
        <p className="lp-swap-instructions-note">
          <em>Note:</em> Only verified Solana addresses can receive USDC. Verification is required before your first swap.
        </p>
      </section>

      <section className="lp-section lp-prize-rules" id="lp-daily-prize-rules" aria-labelledby="lp-prize-rules-heading">
        <h2 id="lp-prize-rules-heading" className="lp-section-title">
          Daily prize rules{" "}
          <span className="lp-rules-effective" style={{ fontWeight: 500, fontSize: "0.85em", color: "var(--muted)" }}>
            (effective 2026-04-19)
          </span>
        </h2>
        <ul className="lp-rules-list">
          <li>
            The pool is <strong>{prizePart} QUSD</strong> per US Eastern calendar day (live configuration). QUSD is an
            in-app ledger unit, not a bank balance.
          </li>
          <li>
            The winner is the single trader with the <strong>highest QUSD</strong> among accounts{" "}
            <strong>eligible for the daily prize</strong> (see Leaderboard / Prize in the app) at the scheduled award time (
            <strong>4:00&nbsp;PM US Eastern Time</strong>).
          </li>
          <li>
            Only <strong>one</strong> top-ranked eligible trader receives the prize each day; there is <strong>no</strong>{" "}
            sharing of the pool.
          </li>
          <li>
            At the award, the winner&apos;s account is credited with QUSD only — a <strong>ledger / accounting entry</strong>.
            The platform does <strong>not</strong> automatically convert the prize to USDC.
          </li>
          <li>
            To obtain <strong>Solana SPL USDC</strong>, the winner (or any user) must initiate a <strong>Swap</strong> on
            the Swap page. The conversion rate is the one displayed there for this deployment.
          </li>
          <li>
            You can also fund QUSD by sending USDC through the app&apos;s deposit path (treasury attribution + ledger
            credit), subject to verification — see Buy QUSD / Account.
          </li>
          <li>
            You must comply with the{" "}
            {onTerms ? (
              <button type="button" className="lp-text-link" onClick={onTerms}>
                Terms of Service
              </button>
            ) : (
              "Terms of Service"
            )}{" "}
            and applicable law, including any identity or compliance steps we require.
          </li>
          <li>
            Attempts to manipulate the leaderboard (for example wash trading, bots, or collusion) may result in{" "}
            <strong>disqualification</strong> and account action.
          </li>
        </ul>
        <p className="lp-rules-support">
          Questions?{" "}
          <a href="mailto:support@solvequest.io" className="lp-inline-link">
            support@solvequest.io
          </a>
        </p>
      </section>

      <section className="lp-section" aria-labelledby="lp-protect-heading">
        <h2 id="lp-protect-heading" className="lp-section-title">
          Understand the risks
        </h2>
        <p className="lp-section-lead" style={{ marginBottom: 20 }}>
          Perpetuals use leverage: adverse moves can reduce or wipe allocated margin quickly.
        </p>
        <div className="lp-shield">
          <ul>
            <li>Allocation is QUSD from your balance</li>
            <li>Closing settles margin + PnL back to QUSD</li>
            <li>Past performance does not guarantee future results</li>
          </ul>
        </div>
      </section>

      <section className="lp-cta-block" aria-labelledby="lp-final-cta-heading">
        <h2 id="lp-final-cta-heading">Start in minutes</h2>
        <p className="lp-cta-steps">Verify email → Link receive address → Trade → Climb the board</p>
        <button type="button" className="lp-btn-primary" onClick={onStartNow}>
          Start trading
        </button>
        <p className="lp-cta-hint lp-cta-hint--footer">Email verification takes ~10 seconds.</p>
        <p className="lp-urgency lp-urgency--prize">
          <span className="lp-urgency-lead">Get verified — compete for </span>
          <span className="lp-urgency-prize">
            <img src="/icon-qusd.png" alt="" className="lp-urgency-prize-icon" width={26} height={26} decoding="async" />
            <span>
              {prizePart} QUSD daily (ledger credit); optional <strong>Solana USDC</strong> via <strong>Swap</strong>.
            </span>
          </span>
        </p>
      </section>

      <p id="lp-swap-footnote" className="lp-page-footnote" tabIndex={-1}>
        <span className="lp-page-footnote-mark">*</span> In-app <strong>Swap</strong> — subject to app rules; a verified
        Solana receive address is required. USDC out is <strong>Solana SPL</strong>. Only QUSD above the app minimum (see
        Swap) converts at the published rate.
      </p>

      {onTerms && onPrivacy ? (
        <footer className="lp-legal-footer">
          <button type="button" className="lp-legal-link" onClick={onTerms}>
            Terms of Service
          </button>
          <span className="lp-legal-sep" aria-hidden>
            ·
          </span>
          <button type="button" className="lp-legal-link" onClick={onPrivacy}>
            Privacy Policy
          </button>
        </footer>
      ) : null}
    </div>
  );
}
