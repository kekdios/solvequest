import type { CSSProperties } from "react";

/** Matches Perps `orderCard` — primary panel surface for app pages. */
export const uiOrderCard: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid color-mix(in srgb, var(--border) 85%, var(--text))",
  borderRadius: 12,
  padding: "22px 20px",
  minWidth: 0,
  boxShadow:
    "inset 0 1px 0 color-mix(in srgb, var(--text) 5%, transparent), 0 6px 28px color-mix(in srgb, var(--text) 5%, transparent)",
};

/** Matches Perps `posCard` — secondary / stat tiles. */
export const uiPosCard: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid color-mix(in srgb, var(--border) 85%, var(--text))",
  borderRadius: 12,
  padding: "22px 20px",
  boxShadow: "inset 0 1px 0 color-mix(in srgb, var(--text) 5%, transparent)",
};

export const uiPageH2: CSSProperties = {
  fontSize: "1.25rem",
  fontWeight: 700,
  letterSpacing: "-0.03em",
  margin: 0,
  color: "var(--text)",
};

export const uiSectionH3: CSSProperties = {
  margin: "0 0 12px",
  fontSize: "1.05rem",
  fontWeight: 700,
  letterSpacing: "-0.02em",
  color: "var(--text)",
};

export const uiFieldLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.07em",
  textTransform: "uppercase",
  color: "color-mix(in srgb, var(--muted) 92%, var(--text))",
};

export const uiInput: CSSProperties = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text)",
  padding: "10px 12px",
  fontSize: 15,
};

export const uiBtnPrimary: CSSProperties = {
  background: "color-mix(in srgb, var(--accent) 18%, var(--panel))",
  border: "1px solid color-mix(in srgb, var(--accent) 45%, var(--border))",
  color: "var(--text)",
  borderRadius: 8,
  padding: "10px 18px",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
  fontFamily: "inherit",
  boxShadow:
    "0 0 0 1px color-mix(in srgb, var(--accent) 12%, transparent), 0 4px 18px color-mix(in srgb, var(--accent) 8%, transparent)",
};

export const uiBtnGhost: CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  color: "var(--muted)",
  borderRadius: 8,
  padding: "10px 16px",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
  fontFamily: "inherit",
};
