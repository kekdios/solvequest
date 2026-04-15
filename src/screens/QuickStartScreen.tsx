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
      "Perps draw from your **QUSD** balance for margin. On **Account**, enter your **Solana address** and **Verify on-chain**—after verification you receive the onboarding QUSD credit; USDC (SPL) sent to that address credits as QUSD after confirmation. In **demo mode**, balances stay in this browser only.",
  },
  {
    title: "Open Perpetuals",
    body:
      "Choose **Perpetuals** in the sidebar. The strip at the top shows your **QUSD** balance. Index prices update from Hyperliquid (live where available).",
  },
  {
    title: "Pick a market",
    body:
      "Use the tabs (BTC, ETH, SOL, GOLD, …) to choose which index you’re trading. The large chart area shows that market’s context; your order is always in the right-hand column.",
  },
  {
    title: "Choose direction",
    body:
      "Tap **Up (long)** if you think the index goes up, or **Down (short)** if you think it goes down.",
  },
  {
    title: "Set size and open",
    body:
      "Enter **margin (QUSD tokens)** in the right column. Leverage is **100× (fixed)**—PnL = margin × index % move × 100. **Remaining** (margin + PnL) hits zero on a large enough adverse move (~1% vs entry at 100× long). Margin must be ≤ your **QUSD** balance. Use the main action (**Up** / **Down** on the market) to open.",
  },
  {
    title: "Manage the trade",
    body:
      "On **Perpetuals**, your open positions appear in the table below the order form. Use **Close** to exit. Settlement is **margin + PnL** back to QUSD.",
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
        Follow these steps once—then use <strong style={{ color: "var(--text)" }}>Perpetuals</strong> whenever
        you want to trade.
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
          Open Perpetuals
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
