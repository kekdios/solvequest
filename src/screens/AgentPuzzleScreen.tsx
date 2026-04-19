import { useCallback, useState, type CSSProperties } from "react";

type Props = {
  isDemo: boolean;
  /** JWT session present (email account). */
  signedIn: boolean;
  onGoAuth: () => void;
  onGoTrade: () => void;
};

const panel: CSSProperties = {
  maxWidth: 800,
  margin: "0 auto",
  padding: "8px 0 40px",
};

const neonCard: CSSProperties = {
  borderRadius: 16,
  border: "1px solid color-mix(in srgb, var(--accent) 45%, var(--border))",
  background:
    "linear-gradient(165deg, color-mix(in srgb, var(--accent) 8%, var(--panel)) 0%, var(--panel) 100%)",
  padding: "24px 20px",
  boxShadow: "0 0 0 1px color-mix(in srgb, var(--accent) 12%, transparent), 0 20px 48px color-mix(in srgb, #000 35%, transparent)",
};

const btnPrimary: CSSProperties = {
  appearance: "none",
  border: "none",
  borderRadius: 999,
  padding: "12px 22px",
  fontWeight: 700,
  fontSize: "0.95rem",
  cursor: "pointer",
  background: "linear-gradient(145deg, #34d399 0%, #059669 100%)",
  color: "#052e1f",
};

const btnGhost: CSSProperties = {
  appearance: "none",
  border: "1px solid var(--border)",
  borderRadius: 999,
  padding: "10px 18px",
  fontWeight: 600,
  fontSize: "0.9rem",
  cursor: "pointer",
  background: "transparent",
  color: "var(--text)",
};

const preBox: CSSProperties = {
  margin: "16px 0 0",
  padding: 16,
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "color-mix(in srgb, var(--bg) 92%, var(--panel))",
  fontSize: 12,
  lineHeight: 1.5,
  overflowX: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  color: "var(--text)",
  maxHeight: "min(70vh, 520px)",
  overflowY: "auto",
};

/** Paste this into Cursor Composer or chat to generate the Tetris prototype. */
const CURSOR_COMPOSER_PROMPT = `Create a complete, fully functional Tetris game as a single HTML file using HTML5 Canvas, vanilla JavaScript, and Tailwind CSS. The game must be themed for **SolveQuest.io**, a crypto trading competition site with dark neon aesthetic (deep blacks, electric blue, purple, cyan accents, glowing effects).

### Core Game Requirements
- Standard Tetris mechanics: 10×20 grid, 7 tetromino types (I, O, T, S, Z, J, L), proper rotation (SRS style if possible), line clearing, next piece preview, score, level progression, soft/hard drop.
- Game runs for up to 3 minutes or until the board overflows.
- Mobile-friendly: keyboard controls + on-screen touch buttons for swipe left/right, rotate, soft drop, hard drop.

### SolveQuest Theme & Crypto Integration
- Dark neon cyber-trading terminal look: grid has subtle grid lines with glowing borders. Background shows faint candlestick charts or Hyperliquid-style price lines.
- Tetrominoes are labeled with crypto/trading terms that appear when they lock:
  - I-piece: "HODL"
  - O-piece: "VAULT"
  - T-piece: "TRADE"
  - S-piece: "LONG"
  - Z-piece: "SHORT"
  - J/L pieces: BIP39 words (randomly chosen from a small predefined list of 24 common words like "agent", "mnemonic", "oracle", "ledger", "yield", etc.).
- When a line is cleared, if it contains a "valid" crypto word combination, give bonus points and show a small particle burst (use canvas-confetti or simple CSS particles).
- Score translates directly to QUSD: 1 QUSD per 8,000 points + 25 QUSD per line cleared with a themed word. Show live "Potential QUSD" counter.

### Reward & Anti-Bot Systems
- At game end, show a prominent "Claim QUSD" button.
- The claim flow must integrate with the existing SolveQuest backend:
  - Generate a tweetnacl detached signature from the user's Solana address (provide placeholder functions \`signScore(score, address)\` and \`submitClaim(payload)\` that simulate the real API call).
  - Payload should include: finalScore, linesCleared, potentialQUSD, timestamp, signature, puzzleId: "daily-tetris".
  - Use Redis-style comment: \`// Backend will use SET ... NX on address + date to prevent double claims\`.
- During play, quietly track behavioral signals for bot detection:
  - Record mouse movements, keypress timing variance, and irregular action patterns.
  - At end, include a \`behaviorScore\` (0–100) in the claim payload. Simple heuristic: penalize perfectly regular intervals.
- Daily cap note: "Max 750 QUSD per user per day from Tetris".

### UI/UX Flow
- Landing screen with "Play Daily Tetris – Earn up to 750 QUSD" + live countdown to next daily reset (4:00 PM ET).
- In-game: neon score display, potential QUSD, level, lines, 3-minute timer that turns red in last 30 seconds.
- Game over screen: final stats, confetti on high scores, "Claim QUSD" button that triggers the signature flow and shows success animation.
- Add a small "How it works" tooltip explaining that high scores help climb the main trading leaderboard.

### Technical Details
- Single-file HTML with embedded Tailwind via CDN.
- Clean, well-commented code with sections clearly labeled for easy Cursor iteration.
- Make it easy to embed into the SolveQuest site (exportable as a component or iframe-friendly).
- Add simple sound effects placeholders (comments where Web Audio API tones would go for line clear, drop, game over).
- Ensure it feels addictive and "flow state" inducing while remaining fair.

Generate the complete working game on first try. Make it polished, responsive, and production-ready for a crypto gaming experience.`;

export default function AgentPuzzleScreen({ isDemo, signedIn, onGoAuth, onGoTrade }: Props) {
  const [copied, setCopied] = useState(false);

  const copyPrompt = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(CURSOR_COMPOSER_PROMPT);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, []);

  return (
    <div style={panel}>
      <div style={neonCard}>
        <p
          style={{
            margin: "0 0 6px",
            fontSize: 12,
            letterSpacing: "0.12em",
            color: "var(--accent)",
            fontWeight: 700,
          }}
        >
          CURSOR · AI WORKFLOW
        </p>
        <h1 style={{ margin: "0 0 12px", fontSize: "1.5rem", lineHeight: 1.2 }}>Prompt to give Cursor AI</h1>

        {(isDemo || !signedIn) && (
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--muted)", lineHeight: 1.55 }}>
            {isDemo ? (
              <>
                You’re in <strong>Demo</strong>. This page is open to everyone — exit Demo and{" "}
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--accent)",
                    cursor: "pointer",
                    textDecoration: "underline",
                    padding: 0,
                    font: "inherit",
                  }}
                  onClick={onGoAuth}
                >
                  sign in with email
                </button>{" "}
                when you want a full account.
              </>
            ) : (
              <>
                <button type="button" style={{ ...btnGhost, marginRight: 10 }} onClick={onGoAuth}>
                  Login / Register
                </button>
                for trading and leaderboard — this prompt works without an account.
              </>
            )}
          </p>
        )}

        <p style={{ margin: "0 0 12px", fontSize: 14, color: "var(--muted)", lineHeight: 1.6 }}>
          Copy and paste this entire prompt into Cursor (use <strong>Gemini 2.5 Pro experimental</strong> or{" "}
          <strong>Claude Sonnet 3.7</strong> for best results):
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <button type="button" style={btnPrimary} onClick={() => void copyPrompt()}>
            {copied ? "Copied!" : "Copy prompt for Cursor"}
          </button>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Pastes the specification below (Composer-ready).</span>
        </div>

        <pre style={preBox}>{CURSOR_COMPOSER_PROMPT}</pre>

        <hr
          style={{
            margin: "28px 0",
            border: "none",
            borderTop: "1px solid var(--border)",
          }}
        />

        <h2 style={{ margin: "0 0 10px", fontSize: "1.15rem" }}>Why this prompt works (based on real Cursor AI results)</h2>
        <p style={{ margin: "0 0 14px", fontSize: 14, color: "var(--muted)", lineHeight: 1.6 }}>
          From multiple documented cases, Cursor AI (especially with Gemini 2.5 Pro experimental) can generate a{" "}
          <strong>complete, bug-free Tetris</strong> from a single prompt like “create a Tetris game”. People have built fully
          playable versions with rotation, line clearing, and next-piece preview in under 10 minutes — sometimes with one
          click.
        </p>
        <p style={{ margin: "0 0 14px", fontSize: 14, color: "var(--muted)", lineHeight: 1.6 }}>
          This prompt adds SolveQuest-specific requirements (QUSD rewards, claim flow with tweetnacl/Redis NX, behavioral
          tracking), crypto theming, and an “active and engaged” mechanic expressed through gameplay instead of idle timers.
        </p>

        <h2 style={{ margin: "20px 0 10px", fontSize: "1.15rem" }}>How to use it with Cursor</h2>
        <ol style={{ margin: 0, paddingLeft: 22, fontSize: 14, color: "var(--muted)", lineHeight: 1.65 }}>
          <li style={{ marginBottom: 8 }}>
            Open Cursor and create a new file <code style={{ color: "var(--text)" }}>solvequest-tetris.html</code>.
          </li>
          <li style={{ marginBottom: 8 }}>Paste the copied prompt into Composer or chat.</li>
          <li style={{ marginBottom: 8 }}>
            Hit <strong>Cmd+K</strong> (or Apply) and let it generate the full file.
          </li>
          <li style={{ marginBottom: 8 }}>Run it locally — it should be playable immediately.</li>
          <li>
            Then iterate, for example: add confetti on line clears; align the claim payload with your backend; rotate labels
            with pieces and add glow; wire behavioral logging for mouse entropy and press timing variance.
          </li>
        </ol>

        <p style={{ margin: "20px 0 0", fontSize: 14, color: "var(--muted)", lineHeight: 1.6 }}>
          This turns the game into a <strong>high-engagement daily hook</strong> that rewards real play, resists naive bots,
          surfaces QUSD in the trading loop, and stays fun for early players.
        </p>

        <p style={{ margin: "18px 0 0", fontSize: 13, color: "var(--muted)", lineHeight: 1.55 }}>
          Want to refine the prompt, add exact backend payload fields, or draft follow-up iteration prompts? Use Cursor on
          this page’s copy or ask in your project chat.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 22 }}>
          <button type="button" style={btnPrimary} onClick={onGoTrade}>
            Back to Trade
          </button>
        </div>
      </div>
    </div>
  );
}
