import { useEffect, useState } from "react";
import "./landing.css";

type Props = {
  onStartNow: () => void;
  /** Navigate to Prize (sell QUSD) screen — used for in-app links from the landing copy. */
  onGoToPrize?: () => void;
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

export default function LandingPage({ onStartNow, onGoToPrize, onTerms, onPrivacy }: Props) {
  const [prizeAmount, setPrizeAmount] = useState<number | null | undefined>(undefined);
  const [claimQuestAmount, setClaimQuestAmount] = useState<number | null | undefined>(undefined);
  const [questMultiplier, setQuestMultiplier] = useState<number | null | undefined>(undefined);
  const [lbRows, setLbRows] = useState<LeaderboardPreviewRow[]>([]);
  const [lbLoading, setLbLoading] = useState(true);
  const [stats, setStats] = useState<LandingStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch("/api/qusd/sell/config", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/leaderboard?limit=3", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/landing-stats", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([cfg, lb, st]) => {
        if (cancelled) return;
        if (cfg && typeof cfg === "object" && "prize_amount" in cfg) {
          const c = cfg as {
            prize_amount?: number;
            claim_quest_amount?: number;
            quest_multiplier?: number;
          };
          const n = c.prize_amount;
          setPrizeAmount(typeof n === "number" && Number.isFinite(n) ? n : null);
          const cq = c.claim_quest_amount;
          setClaimQuestAmount(typeof cq === "number" && Number.isFinite(cq) ? cq : null);
          const qm = c.quest_multiplier;
          setQuestMultiplier(typeof qm === "number" && Number.isFinite(qm) ? qm : null);
        } else {
          setPrizeAmount(null);
          setClaimQuestAmount(null);
          setQuestMultiplier(null);
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
          setClaimQuestAmount(null);
          setQuestMultiplier(null);
          setLbRows([]);
          setLbLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const usdPart =
    prizeAmount === undefined
      ? "…"
      : prizeAmount === null
        ? "—"
        : prizeAmount.toLocaleString(undefined, { maximumFractionDigits: 2 });

  const claimQuestStr =
    claimQuestAmount === undefined
      ? "…"
      : claimQuestAmount === null
        ? "—"
        : claimQuestAmount.toLocaleString(undefined, { maximumFractionDigits: 6 });

  const questMultStr =
    questMultiplier === undefined
      ? "…"
      : questMultiplier === null
        ? "—"
        : questMultiplier.toLocaleString(undefined, { maximumFractionDigits: 0 });

  return (
    <div className="lp">
      <section className="lp-hero" aria-labelledby="lp-hero-heading">
        <div className="lp-hero-inner">
          <p className="lp-eyebrow">Solve Quest</p>
          <h1 id="lp-hero-heading" className="lp-title lp-title--game">
            Compete in a Trading Game
          </h1>
          <p className="lp-hero-tagline">Crypto paper trading on Solana · Real index marks</p>
          <p className="lp-hero-lead">
            Start with <strong>30,000 free QUSD</strong>, climb the leaderboard,{" "}
            <span className="lp-hero-compete">
              and compete for{" "}
              <span className="lp-hero-prize-line">
                <img src="/prize-usdc.png" alt="" width={26} height={26} className="lp-hero-usdc-icon" />
                <strong className="lp-hero-prize">${usdPart} USDC</strong>
              </span>
              .
            </span>
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
                . Deposits and on-chain USDC use your verified{" "}
                <a href="https://solana.com/" target="_blank" rel="noopener noreferrer">
                  Solana
                </a>{" "}
                receive address (see Account).
              </span>
            </p>
          </div>

          <p className="lp-sub lp-sub--hero">
            Trade using Hyperliquid index prices. No deposit required to start.
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
              <img src="/prize-usdc.png" alt="" width={20} height={20} />
              <span>Season prize pool</span>
            </li>
          </ul>
          <p className="lp-leverage-tagline lp-leverage-tagline--tight">
            Multiple{" "}
            <img
              src="/icon-qusd.png"
              alt=""
              className="lp-leverage-tagline-qusd"
              width={22}
              height={22}
              decoding="async"
            />{" "}
            10,000 QUSD awarded to verified active users daily
          </p>
          <div className="lp-cta-stack">
            <button type="button" className="lp-btn-primary" onClick={onStartNow}>
              Start Now
            </button>
            <p className="lp-cta-hint">Email verification takes ~10 seconds.</p>
          </div>
        </div>
      </section>

      <section className="lp-section lp-leader-preview" aria-labelledby="lp-lb-heading">
        <h2 id="lp-lb-heading" className="lp-section-title">
          Top traders right now
        </h2>
        <p className="lp-section-lead lp-section-lead--tight">
          Real QUSD balances from our server leaderboard (masked emails for privacy).
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
          How prizes &amp; USDC work
        </h2>
        <p className="lp-section-lead lp-section-lead--tight">
          Short answers — full rules, QUEST purchase, and timing are on the{" "}
          {onGoToPrize ? (
            <button type="button" className="lp-text-link" onClick={onGoToPrize}>
              Prize
            </button>
          ) : (
            "Prize"
          )}{" "}
          page.
        </p>
        <div className="lp-faq-list">
          <details className="lp-faq-item">
            <summary>What is QUSD vs real USDC?</summary>
            <p>
              <strong>QUSD</strong> is in-game balance for paper trading: you allocate it to positions, and closed trades
              settle back into QUSD. It is not cash in your bank. <strong>USDC</strong> in the seasonal prize pool is a
              real stablecoin; how eligibility, winners, and payouts work is defined on the Prize page and may change
              between seasons.
            </p>
          </details>
          <details className="lp-faq-item">
            <summary>How does trading performance connect to the USDC pool?</summary>
            <p>
              You compete using QUSD on the leaderboard. To bridge toward prize eligibility, the app uses{" "}
              <strong>QUEST</strong> (on Solana): you spend QUSD to buy QUEST at the configured rate (currently{" "}
              <strong>{questMultStr} QUSD per 1 QUEST</strong>). Holding at least{" "}
              <strong>{claimQuestStr} QUEST</strong> is required to <em>claim</em> prize qualification as described on
              the Prize screen — read that page for the authoritative rules.
            </p>
          </details>
          <details className="lp-faq-item">
            <summary>When and how is USDC paid?</summary>
            <p>
              Payout schedules, seasons, and any tiers or winner counts are published on the{" "}
              {onGoToPrize ? (
                <button type="button" className="lp-text-link" onClick={onGoToPrize}>
                  Prize
                </button>
              ) : (
                "Prize"
              )}{" "}
              page. USDC moves on <strong>Solana</strong> to the receive address you verify on <strong>Account</strong>.
              If anything is unclear, use the contact email on Prize.
            </p>
          </details>
          <details className="lp-faq-item">
            <summary>Do I need to deposit money to start?</summary>
            <p>
              No — you can begin with promotional QUSD after email verification. Optional USDC deposits to your Solana
              address are only if you choose to fund activity that way; the game itself is built around paper-style QUSD
              trading first.
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
            <h3>Verify email and wallet</h3>
            <p>Sign in with email (OTP), then verify your Solana receive address on Account for deposits and prizes.</p>
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
              Trade to accumulate enough QUSD to claim the PRIZE{" "}
              <span className="lp-step3-sub">
                (see{" "}
                {onGoToPrize ? (
                  <button type="button" className="lp-text-link" onClick={onGoToPrize}>
                    Prize
                  </button>
                ) : (
                  "Prize"
                )}{" "}
                page for details)
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

      <section className="lp-section lp-prize-urgency" aria-labelledby="lp-prize-urgency-heading">
        <h2 id="lp-prize-urgency-heading" className="lp-section-title">
          Season prize pool
        </h2>
        <div className="lp-prize-urgency-inner">
          <img src="/prize-usdc.png" alt="" width={40} height={40} className="lp-prize-urgency-icon" />
          <div>
            <p className="lp-prize-urgency-amount">
              <strong>${usdPart} USDC</strong> prize pool
            </p>
            <p className="lp-prize-urgency-copy">
              Rules, QUEST requirements, and timing are on the{" "}
              {onGoToPrize ? (
                <button type="button" className="lp-text-link" onClick={onGoToPrize}>
                  Prize
                </button>
              ) : (
                "Prize"
              )}{" "}
              page. Promotional QUSD awards may run on a schedule — check there for the latest.
            </p>
          </div>
        </div>
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
        <p className="lp-cta-steps">Verify email → Link Solana → Trade → Climb the board</p>
        <button type="button" className="lp-btn-primary" onClick={onStartNow}>
          Start Now
        </button>
        <p className="lp-cta-hint lp-cta-hint--footer">Email verification takes ~10 seconds.</p>
        <p className="lp-urgency lp-urgency--prize">
          <span className="lp-urgency-lead">Get verified to compete —</span>{" "}
          <span className="lp-urgency-prize">
            <img src="/prize-usdc.png" alt="" className="lp-urgency-usdc" width={26} height={26} decoding="async" />
            <span>${usdPart} USDC in the seasonal pool.</span>
          </span>
        </p>
      </section>

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
