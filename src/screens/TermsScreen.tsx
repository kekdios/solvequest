import "./legal-doc.css";

const LEGAL_EMAIL = "privacyemail369@gmail.com";
const SUPPORT_EMAIL = "support@solvequest.io";

export default function TermsScreen() {
  return (
    <article className="legal-doc">
      <p className="legal-meta">Last updated: April 15, 2026</p>
      <p>
        These Terms of Service (“Terms”) govern your access to and use of the Solve Quest website and application
        (“Service”) operated by us (“we,” “us,” or “our”). By accessing or using the Service, you agree to these Terms.
        If you do not agree, do not use the Service.
      </p>

      <h2>1. The Service</h2>
      <p>
        Solve Quest provides a simulated trading experience using in-app balances (including QUSD) and market reference
        data. The Service may include leaderboards, promotional prize pools, and related features. Nothing on the Service
        is an offer or solicitation to buy or sell securities, derivatives, or regulated financial products in any
        jurisdiction.
      </p>
      <p>
        <strong>Open positions.</strong> Your open positions are not monitored or marked to market while you are not
        actively using the Service (for example, when you have closed the site or your session is not loaded in the
        app). When you log back in or return to the Service, current reference prices are applied and your positions may
        be evaluated for liquidation under the app’s rules at that time. As a result, a position that would have been
        liquidated had you stayed online may instead be auto-liquidated when you next use the app, and outcomes can differ
        from what you would have seen with continuous monitoring.
      </p>

      <h2>2. Not financial advice</h2>
      <p>
        Content is for informational and entertainment purposes only. Leveraged and perpetual-style trading involves
        substantial risk of loss. Past performance does not guarantee future results. You are solely responsible for
        your decisions.
      </p>

      <h2>3. Eligibility</h2>
      <p>
        You represent that you are at least 18 years old (or the age of majority where you live) and that you have legal
        capacity to enter these Terms. You are responsible for complying with applicable laws where you access the
        Service.
      </p>

      <h2>4. Accounts and authentication</h2>
      <p>
        You may need to register with an email address and complete verification steps (including wallet or address
        verification where required). You agree to provide accurate information and to keep your credentials secure. You
        are responsible for activity under your account.
      </p>

      <h2>5. Virtual balances and promotions</h2>
      <p>
        QUSD and similar in-app units are digital ledger entries for use within the Service unless expressly stated
        otherwise. Promotional awards, prize pools, and eligibility rules are described in the app and may change.
        We may suspend or adjust promotions to prevent abuse or comply with law.
      </p>
      <p>
        <strong>Daily QUSD prize.</strong> Where enabled, the Service may automatically credit a <strong>configured</strong>{" "}
        QUSD amount for that promotion (see the Prize screen and public configuration in the app) to <strong>one</strong>{" "}
        winning account per <strong>US Eastern calendar day</strong> (as determined by the Service using the{" "}
        <strong>America/New_York</strong> time zone). For each such day, the winner is the account with the{" "}
        <strong>highest total QUSD balance</strong> (per the Service ledger) among accounts that are{" "}
        <strong>prize-eligible</strong> for that award — meaning, unless the app states otherwise, registered accounts that{" "}
        have <strong>not</strong> already received this automatic daily prize under the current rules (
        <strong>one such win per account over the lifetime of the account</strong>). <strong>There is no splitting</strong>{" "}
        of the pool: the full configured amount for that day is credited to that single winning account as{" "}
        <strong>QUSD only</strong> (a ledger / accounting entry). The Service does <strong>not</strong> automatically
        convert that prize to USDC; conversion or withdrawal in USDC requires a separate user-initiated swap or transfer
        flow where offered, subject to app rules. The automatic run is scheduled for approximately{" "}
        <strong>4:00 PM US Eastern Time</strong> when the server is operating; we do not guarantee uninterrupted or
        error-free execution. How eligibility, “Prize #,” and any tie-breakers work is shown in the app (including
        Leaderboard and Prize). Displayed winner names use the public leaderboard handle assigned in the app. We may
        withhold or revoke prizes and take other account action if we believe the leaderboard or prize process was
        manipulated (see Prohibited conduct).
      </p>

      <h2>6. QUSD and USDC swaps</h2>
      <p>
        Where the Service allows swapping or conversion between QUSD and USDC, the availability, rules, and execution of
        those swaps are determined solely by Solve Quest. Exchange rates for QUSD and USDC (in either direction) are set
        solely by Solve Quest and may change, subject to these Terms and any rates or limits shown in the app. Rates are{" "}
        <strong>set by Solve Quest</strong> for the deployment (as shown on the Swap screen) and are not necessarily tied
        to a third-party order book. For QUSD→USDC swaps, the Service may apply a configured minimum QUSD threshold so
        that only QUSD above that amount (after capping the amount you designate to your spendable balance) converts at
        the published rate, as described on the Swap screen. Outgoing USDC may be delivered as <strong>Solana SPL</strong>{" "}
        tokens to your verified address where that flow is supported. Swaps may also be subject to per-transaction
        maximums, rounding, treasury USDC availability, and network or operational limits shown or enforced in the app.
      </p>

      <h2>7. Prohibited conduct</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service in violation of law or third-party rights</li>
        <li>Attempt to gain unauthorized access, interfere with, or overload the Service</li>
        <li>Use automated means in a way that harms fair play or stability (including bots or scripts where prohibited)</li>
        <li>
          Manipulate leaderboards, prizes, or trading activity (including wash trading, collusion, or artificial volume)
          in a way that undermines fair play or misleads the Service or other users
        </li>
        <li>Mislead us or other users, or exploit bugs or vulnerabilities</li>
      </ul>

      <h2>8. Third-party data and networks</h2>
      <p>
        The Service may display prices or data from third parties (for example, index or mark data attributed to
        Hyperliquid or similar sources). Blockchain transactions may rely on public networks such as Solana. We do not
        control third-party systems; their availability and accuracy are not guaranteed.
      </p>

      <h2>9. Disclaimers</h2>
      <p>
        THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE,” WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED,
        INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT, TO THE FULLEST EXTENT
        PERMITTED BY LAW.
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE AND OUR AFFILIATES WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
        SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA, OR GOODWILL, ARISING FROM YOUR USE OF
        THE SERVICE. OUR TOTAL LIABILITY FOR ANY CLAIM ARISING OUT OF THESE TERMS OR THE SERVICE WILL NOT EXCEED THE
        GREATER OF (A) THE AMOUNT YOU PAID US FOR THE SERVICE IN THE TWELVE MONTHS BEFORE THE CLAIM OR (B) ONE HUNDRED
        U.S. DOLLARS (USD $100), EXCEPT WHERE PROHIBITED BY LAW.
      </p>

      <h2>11. Changes</h2>
      <p>
        We may modify these Terms from time to time. We will post the updated Terms with a new “Last updated” date.
        Continued use after changes constitutes acceptance of the revised Terms.
      </p>

      <h2>12. Termination</h2>
      <p>
        We may suspend or terminate access to the Service if you breach these Terms or if we need to protect the Service
        or other users. You may stop using the Service at any time.
      </p>

      <h2>13. Governing law</h2>
      <p>
        These Terms are governed by the laws of the United States and the State of Delaware, excluding conflict-of-law
        rules, unless applicable law requires otherwise.
      </p>

      <h2>14. Contact</h2>
      <p>
        Questions about these Terms: <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a>. Operational questions (including
        prizes and swaps): <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
    </article>
  );
}
