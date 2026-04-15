import { useEffect, useState } from "react";
import "./landing.css";

type Props = {
  onStartNow: () => void;
  /** Navigate to Prize (sell QUSD) screen — used for in-app links from the landing copy. */
  onGoToPrize?: () => void;
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

export default function LandingPage({ onStartNow, onGoToPrize }: Props) {
  const [prizeAmount, setPrizeAmount] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/qusd/sell/config", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { prize_amount?: number } | null) => {
        if (cancelled || !j) return;
        const n = j.prize_amount;
        setPrizeAmount(typeof n === "number" && Number.isFinite(n) ? n : null);
      })
      .catch(() => {
        if (!cancelled) setPrizeAmount(null);
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

  return (
    <div className="lp">
      <section className="lp-hero" aria-labelledby="lp-hero-heading">
        <div className="lp-hero-inner">
          <p className="lp-eyebrow">Solve Quest</p>
          <h1 id="lp-hero-heading" className="lp-title lp-title--prize-hero">
            <span className="lp-title-shine">Compete for</span>{" "}
            <span
              className="lp-title-prize-amount"
              aria-label={
                typeof prizeAmount === "number" ? `Prize pool about ${prizeAmount} USDC` : undefined
              }
            >
              <img
                src="/prize-usdc.png"
                alt=""
                className="lp-title-usdc-icon"
                width={44}
                height={44}
                decoding="async"
              />
              <span className="lp-title-shine lp-title-usd">
                ${usdPart} USDC
              </span>
            </span>{" "}
            <span className="lp-title-shine">PRIZE</span>
          </h1>
          <p className="lp-sub">Trade perpetual-style markets. Synced with Hyperliquid.</p>
          <div className="lp-qusd-ribbon">
            <img
              src="/icon-qusd.png"
              alt=""
              className="lp-qusd-ribbon-icon"
              width={52}
              height={52}
            />
            <div className="lp-qusd-ribbon-copy">
              <p className="lp-qusd-ribbon-lead">
                You receive <strong>30,000 QUSD</strong> as a free <strong>BONUS</strong> when fully verified.
              </p>
            </div>
          </div>
          <p className="lp-leverage-tagline">
            Multiple{" "}
            <img
              src="/icon-qusd.png"
              alt=""
              className="lp-leverage-tagline-qusd"
              width={24}
              height={24}
              decoding="async"
            />{" "}
            10,000 QUSD awarded to verified active users daily
          </p>
          <div className="lp-cta-row">
            <button type="button" className="lp-btn-primary" onClick={onStartNow}>
              Start Now
            </button>
          </div>
        </div>
      </section>

      <section className="lp-section" aria-labelledby="lp-how-heading">
        <h2 id="lp-how-heading" className="lp-section-title">
          How It Works
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
            <h3>Choose Direction</h3>
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
          Why Users Love Us
        </h2>
        <div className="lp-grid-2">
          <div className="lp-feature">
            <span className="lp-feature-icon" aria-hidden>
              <IconChart />
            </span>
            <div>
              <h3>Real market data</h3>
              <p>We sync directly with Hyperliquid price feeds for full transparency.</p>
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
          <div className="lp-feature">
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
        <h2 id="lp-final-cta-heading">Start Trading in Minutes</h2>
        <p className="lp-cta-steps">
          Verify Account Info → Collect Bonus QUSD → Trade → Watch Your Balance Grow
        </p>
        <button type="button" className="lp-btn-primary" onClick={onStartNow}>
          Start Now
        </button>
        <p className="lp-urgency lp-urgency--prize">
          <span className="lp-urgency-lead">Get verified to compete —</span>{" "}
          <span className="lp-urgency-prize">
            <img src="/prize-usdc.png" alt="" className="lp-urgency-usdc" width={26} height={26} decoding="async" />
            <span>
              ${usdPart} USDC is waiting to be claimed.
            </span>
          </span>
        </p>
      </section>
    </div>
  );
}
