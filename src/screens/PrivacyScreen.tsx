import "./legal-doc.css";

const SUPPORT_EMAIL = "privacyemail369@gmail.com";

export default function PrivacyScreen() {
  return (
    <article className="legal-doc">
      <p className="legal-meta">Last updated: April 17, 2026</p>
      <p>
        This Privacy Policy describes how Solve Quest (“we,” “us,” or “our”) collects, uses, and shares information when
        you use our website and application (the “Service”).
      </p>

      <h2>1. Information we collect</h2>
      <p>We may collect:</p>
      <ul>
        <li>
          <strong>Account data:</strong> email address and authentication identifiers (for example, one-time sign-in
          codes and session tokens).
        </li>
        <li>
          <strong>Wallet and on-chain data:</strong> Solana addresses you provide for deposits, verification, or prizes,
          and related transaction references visible on public blockchains.
        </li>
        <li>
          <strong>Service usage:</strong> trading and ledger activity associated with your account (for example, QUSD
          balances, positions, and history stored on our servers).
        </li>
        <li>
          <strong>Technical data:</strong> IP address, approximate location derived from IP, browser type, and pages or
          paths visited (for example, to improve reliability and security).
        </li>
      </ul>

      <h2>2. How we use information</h2>
      <p>We use information to:</p>
      <ul>
        <li>Provide, secure, and improve the Service</li>
        <li>Authenticate users and prevent fraud or abuse</li>
        <li>Operate leaderboards, prize pools, and promotional features described in the app</li>
        <li>Analyze aggregate usage and fix errors</li>
        <li>Comply with legal obligations and enforce our Terms of Service</li>
      </ul>

      <h2>3. Cookies and similar technologies</h2>
      <p>
        We may use cookies or local storage to keep you signed in and remember preferences. You can control cookies
        through your browser settings; disabling them may limit certain features.
      </p>

      <h2>4. Sharing of information</h2>
      <p>
        We do not sell your personal information. We may share information with service providers who assist us (for
        example, hosting or infrastructure), when required by law, or to protect rights and safety. Blockchain data you
        submit may be publicly visible on-chain independent of us.
      </p>

      <h2>5. Data retention</h2>
      <p>
        We retain information as long as needed to provide the Service, comply with law, resolve disputes, and enforce
        our agreements. Retention periods may vary by data type.
      </p>

      <h2>6. Security</h2>
      <p>
        We use reasonable administrative and technical safeguards. No method of transmission or storage is 100% secure;
        we cannot guarantee absolute security.
      </p>

      <h2>7. Your choices and rights</h2>
      <p>
        Depending on where you live, you may have rights to access, correct, or delete certain personal information, or
        to object to or restrict processing. Contact us at the email below to make a request. We may verify your
        identity before responding.
      </p>

      <h2>8. Children</h2>
      <p>The Service is not directed at children under 13 (or the age required in your jurisdiction). We do not knowingly collect personal information from children.</p>

      <h2>9. International users</h2>
      <p>
        If you access the Service from outside the United States, your information may be processed in the United States
        or other countries where we or our providers operate.
      </p>

      <h2>10. Changes to this policy</h2>
      <p>
        We may update this Privacy Policy from time to time. We will post the revised policy with an updated “Last
        updated” date. Continued use after changes constitutes acceptance of the updated policy where permitted by law.
      </p>

      <h2>11. Contact</h2>
      <p>
        Privacy questions: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </p>
    </article>
  );
}
