/** Renders the QUSD coin icon immediately before the “QUSD” label in running text. */
export function QusdWithIcon({ size = 15 }: { size?: number }) {
  return (
    <>
      <img
        src="/icon-qusd.png"
        alt=""
        width={size}
        height={size}
        decoding="async"
        style={{ verticalAlign: "-0.2em", marginRight: 3, display: "inline-block" }}
      />
      QUSD
    </>
  );
}
