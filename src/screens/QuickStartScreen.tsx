import type { CSSProperties, ReactNode } from "react";
import { uiBtnGhost, uiBtnPrimary, uiPosCard } from "../ui/appSurface";

type Props = {
  onGoToPerps: () => void;
  onGoToAccount: () => void;
};

const STEPS: { title: string; body: string }[] = [
  {
    title: "Know your QUSD",
    body:
      "Perpetual-style trades use your **QUSD** balance for margin. You can earn up to **30,000 QUSD** in one-time credits: **10,000** when your account is created, **10,000** after your first successful **email (OTP)** verification, and **10,000** when you verify a **Solana** receive address on **Account**. USDC (SPL) sent to that address credits as QUSD after on-chain confirmation. Promotions may include additional awards for verified users (for example, **10,000 QUSD** daily for active users—see the home page and in-app notices). In **demo mode**, balances stay in this browser only.",
  },
  {
    title: "Open Trade",
    body:
      "Choose **Trade** in the sidebar. The top strip shows your **QUSD** balance. Index marks update from Hyperliquid where available.",
  },
  {
    title: "Pick a market",
    body:
      "Use the tabs (BTC, ETH, SOL, GOLD, …) to select an index. The chart shows that market’s context; your order controls stay in the right-hand column.",
  },
  {
    title: "Choose direction",
    body:
      "Tap **Up (long)** if you expect the index to rise, or **Down (short)** if you expect it to fall.",
  },
  {
    title: "Set size and open",
    body:
      "Enter **margin (QUSD)** in the right column. Leverage is fixed at **100×**: PnL ≈ margin × index % move × 100. **Remaining** (margin + PnL) reaches zero on a large enough adverse move (about **1%** against a 100× long at entry). Margin cannot exceed your **QUSD** balance. Use **Up** or **Down** on the market to open.",
  },
  {
    title: "Manage the trade",
    body:
      "On **Trade**, open positions appear in the table below the order form. Tap **Close** to exit. Settlement returns **margin + PnL** to QUSD.",
  },
];

function renderBody(text: string) {
  const parts = text.split("**");
  const out: ReactNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      out.push(
        <strong key={i} style={{ color: "var(--text)", fontWeight: 600 }}>
          {parts[i]}
        </strong>,
      );
    } else {
      out.push(parts[i]);
    }
  }
  return out;
}

export default function QuickStartScreen({ onGoToPerps, onGoToAccount }: Props) {
  return (
    <div className="app-page" style={s.wrap}>
      <p style={s.lead}>
        After you sign in, the app opens on <strong style={{ color: "var(--text)" }}>Trade</strong> when you load the
        site; you can use <strong style={{ color: "var(--text)" }}>Home</strong> in the sidebar anytime. Follow these
        steps once, then open <strong style={{ color: "var(--text)" }}>Trade</strong> whenever you want to place or
        manage positions.
      </p>

      <ol style={s.list}>
        {STEPS.map((step, i) => (
          <li key={step.title} style={s.item}>
            <span style={s.num} aria-hidden>
              {i + 1}
            </span>
            <div style={s.itemBody}>
              <h2 style={s.itemTitle}>{step.title}</h2>
              <p style={s.itemText}>{renderBody(step.body)}</p>
            </div>
          </li>
        ))}
      </ol>

      <div style={s.ctaBar}>
        <button type="button" style={s.btnPrimary} onClick={onGoToPerps}>
          Open Trade
        </button>
        <button type="button" style={s.btnGhost} onClick={onGoToAccount}>
          Account
        </button>
      </div>

    </div>
  );
}

const s: Record<string, CSSProperties> = {
  wrap: {
    maxWidth: 720,
    margin: "0 auto",
  },
  lead: {
    margin: "0 0 24px",
    fontSize: 15,
    lineHeight: 1.6,
    color: "var(--muted)",
  },
  list: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 18,
  },
  item: {
    display: "flex",
    gap: 14,
    alignItems: "flex-start",
    ...uiPosCard,
    padding: "18px 20px",
  },
  num: {
    flexShrink: 0,
    width: 28,
    height: 28,
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 13,
    fontWeight: 700,
    color: "var(--accent)",
    background: "color-mix(in srgb, var(--accent) 12%, var(--bg))",
    border: "1px solid color-mix(in srgb, var(--accent) 35%, var(--border))",
  },
  itemBody: { minWidth: 0, flex: 1 },
  itemTitle: {
    margin: "0 0 8px",
    fontSize: "1.05rem",
    fontWeight: 700,
    color: "var(--text)",
    letterSpacing: "-0.02em",
  },
  itemText: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.55,
    color: "var(--muted)",
  },
  ctaBar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    marginTop: 28,
  },
  btnPrimary: {
    ...uiBtnPrimary,
    padding: "10px 20px",
  },
  btnGhost: {
    ...uiBtnGhost,
  },
};
