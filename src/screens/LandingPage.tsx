import "./landing.css";

type Props = {
  onStartNow: () => void;
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

function IconChip({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="7" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11h2M14 11h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconShield({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3 5 6v6c0 5 3.5 8.5 7 10 3.5-1.5 7-5 7-10V6l-7-3Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
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

export default function LandingPage({ onStartNow }: Props) {
  return (
    <div className="lp">
      <section className="lp-hero" aria-labelledby="lp-hero-heading">
        <div className="lp-hero-inner">
          <p className="lp-eyebrow">Solve Quest</p>
          <h1 id="lp-hero-heading" className="lp-title">
            Turn Market Direction Into Daily Profits
          </h1>
          <p className="lp-sub">Powered by AI. Synced with Hyperliquid. QUSD margin and vault tools in one place.</p>
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
                You receive <strong>$100 worth of QUSD</strong> (10,000 QUSD) as a free{" "}
                <strong>BONUS</strong> to test the app.
              </p>
              <p className="lp-qusd-ribbon-lock">
                Lock QUSD anytime to earn <strong>1% interest per day</strong>—stack yield while you trade or
                hold.
              </p>
            </div>
          </div>
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
          Three steps from idea to execution—without watching charts all day.
        </p>
        <div className="lp-grid-3">
          <article className="lp-card">
            <span className="lp-step-num" aria-hidden>
              1
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
              2
            </span>
            <h3>Activate AI Execution</h3>
            <p>
              Our proprietary AI monitors Hyperliquid in real time and executes optimal entries and exits
              for you.
            </p>
          </article>
          <article className="lp-card">
            <span className="lp-step-num" aria-hidden>
              3
            </span>
            <h3>Earn Consistent Returns</h3>
            <p>Sit back while the system manages risk and maximizes profit.</p>
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
              <h3>Real Market Data</h3>
              <p>We sync directly with Hyperliquid price feeds for full transparency</p>
            </div>
          </div>
          <div className="lp-feature">
            <span className="lp-feature-icon" aria-hidden>
              <IconChip />
            </span>
            <div>
              <h3>AI-Powered Trading</h3>
              <p>Advanced models analyze market movements 24/7</p>
            </div>
          </div>
          <div className="lp-feature">
            <span className="lp-feature-icon" aria-hidden>
              <IconShield />
            </span>
            <div>
              <h3>Risk-aware design</h3>
              <p>See unrealized PnL and liquidation-style remaining balance before you close</p>
            </div>
          </div>
          <div className="lp-feature">
            <span className="lp-feature-icon" aria-hidden>
              <IconSpark />
            </span>
            <div>
              <h3>No Experience Needed</h3>
              <p>Beginner-friendly. No complex trading knowledge required</p>
            </div>
          </div>
          <div className="lp-feature lp-feature--wide">
            <span className="lp-feature-icon lp-feature-icon--img" aria-hidden>
              <img src="/icon-qusd.png" alt="" width={22} height={22} />
            </span>
            <div>
              <h3>Lock QUSD, Earn Daily Interest</h3>
              <p>
                Put your QUSD to work: lock it in the vault for <strong>1% per day</strong>—transparent
                accrual you can unlock when you&apos;re ready.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-section" aria-labelledby="lp-example-heading">
        <h2 id="lp-example-heading" className="lp-section-title">
          Example Trade
        </h2>
        <div className="lp-example">
          <div className="lp-example-flow">
            <div className="lp-example-row">
              <span className="lp-example-arrow">→</span>
              User selects <strong>LONG</strong> on ETH
            </div>
            <div className="lp-example-row">
              <span className="lp-example-arrow">→</span>
              AI executes trade
            </div>
            <div className="lp-example-row">
              <span className="lp-example-arrow">→</span>
              Market moves up
            </div>
          </div>
          <div className="lp-example-totals">
            <div className="gain">Illustrative P/L: +120 USD</div>
          </div>
        </div>
      </section>

      <section className="lp-section" aria-labelledby="lp-protect-heading">
        <h2 id="lp-protect-heading" className="lp-section-title">
          Understand the risk
        </h2>
        <p className="lp-section-lead" style={{ marginBottom: 20 }}>
          Perpetuals use leverage: adverse moves can reduce or wipe allocated margin quickly.
        </p>
        <div className="lp-shield">
          <ul>
            <li>Allocation is QUSD from your unlocked balance</li>
            <li>Closing settles margin + PnL back to unlocked QUSD</li>
            <li>Past performance does not guarantee future results—this is a demo-style experience</li>
          </ul>
        </div>
      </section>

      <section className="lp-section" aria-labelledby="lp-live-heading">
        <h2 id="lp-live-heading" className="lp-section-title">
          Live Results
        </h2>
        <div className="lp-stats">
          <div className="lp-stat">
            <div className="lp-stat-value">1.2% – 2.8%</div>
            <div className="lp-stat-label">Average daily return</div>
          </div>
          <div className="lp-stat">
            <div className="lp-stat-value">87%</div>
            <div className="lp-stat-label">Win rate</div>
          </div>
          <div className="lp-stat">
            <div className="lp-stat-value">42,000+</div>
            <div className="lp-stat-label">Active users</div>
          </div>
        </div>
      </section>

      <section className="lp-cta-block" aria-labelledby="lp-final-cta-heading">
        <h2 id="lp-final-cta-heading">Start Earning in Minutes</h2>
        <p className="lp-cta-steps">Deposit → Activate AI → Watch Your Balance Grow</p>
        <p className="lp-cta-lock">
          Lock your QUSD for <strong>1% daily interest</strong>—stack yield alongside AI-driven trades.
        </p>
        <button type="button" className="lp-btn-primary" onClick={onStartNow}>
          Start Now
        </button>
        <p className="lp-urgency">Limited Spots Available — AI capacity is restricted to ensure performance</p>
      </section>
    </div>
  );
}
