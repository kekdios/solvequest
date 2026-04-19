import type { CSSProperties } from "react";

type Props = {
  isDemo: boolean;
  /** JWT session present (email account). */
  signedIn: boolean;
  onGoAuth: () => void;
  onGoTrade: () => void;
};

const wrap: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  width: "100%",
};

const banner: CSSProperties = {
  flexShrink: 0,
  padding: "10px 14px",
  fontSize: 13,
  color: "var(--muted)",
  borderBottom: "1px solid color-mix(in srgb, var(--accent) 25%, var(--border))",
  background: "color-mix(in srgb, var(--panel) 92%, transparent)",
};

const frame: CSSProperties = {
  flex: 1,
  width: "100%",
  minHeight: "min(88vh, 920px)",
  border: "none",
  display: "block",
  background: "#050810",
};

/**
 * Daily Tetris — single-file game at `/solvequest-tetris.html` (Canvas + Tailwind + claim placeholders).
 */
export default function AgentPuzzleScreen({ isDemo, signedIn, onGoAuth, onGoTrade }: Props) {
  return (
    <div style={wrap}>
      {(isDemo || !signedIn) && (
        <div style={banner}>
          {isDemo ? (
            <>
              Demo mode — Tetris and <strong>Claim QUSD</strong> use simulated signatures. Exit Demo and{" "}
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
                sign in
              </button>{" "}
              for a real account.
            </>
          ) : (
            <>
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
                Sign in
              </button>{" "}
              for trading; the game runs without an account.{" "}
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
                onClick={onGoTrade}
              >
                Trade
              </button>
            </>
          )}
        </div>
      )}
      <iframe title="SolveQuest Daily Tetris" src="/solvequest-tetris.html" style={frame} />
    </div>
  );
}
