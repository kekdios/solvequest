import type { CSSProperties } from "react";

const ICON = "/icon-qusd.png";

export function QusdIcon({ size = 14, style }: { size?: number; style?: CSSProperties }) {
  return (
    <img
      src={ICON}
      alt=""
      width={size}
      height={size}
      style={{
        verticalAlign: "-3px",
        display: "inline-block",
        objectFit: "contain",
        ...style,
      }}
    />
  );
}

/** Formatted QUSD amounts with icon (numbers are still plain floats in state). */
export function QusdAmount({
  value,
  maximumFractionDigits = 2,
  strong,
  color,
  className,
  iconSize = 15,
  amountStyle,
}: {
  value: number;
  maximumFractionDigits?: number;
  strong?: boolean;
  color?: string;
  className?: string;
  iconSize?: number;
  amountStyle?: CSSProperties;
}) {
  const text = value.toLocaleString(undefined, { maximumFractionDigits });
  const Wrapper = strong ? "strong" : "span";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        ...(color ? { color } : {}),
      }}
      className={className}
    >
      <QusdIcon size={iconSize} />
      <Wrapper className="mono" style={amountStyle}>
        {text} QUSD
      </Wrapper>
    </span>
  );
}

/** Inline label “QUSD” with icon for prose (e.g. ceilings). */
export function QusdWord({ size = 13 }: { size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
      <QusdIcon size={size} />
      <span style={{ fontWeight: 600 }}>QUSD</span>
    </span>
  );
}
