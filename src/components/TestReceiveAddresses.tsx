import { useCallback, useEffect, useState, type CSSProperties } from "react";
import QRCode from "react-qr-code";
import {
  getOrCreateAccountReceiveWallet,
  type AccountReceiveWallet,
} from "../lib/accountReceiveAddresses";
function CopyIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 7V5a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-2M8 7h8a2 2 0 012 2v8"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function QrIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm13-2h2v2h-2v-2zm-4 0h2v2h4v4h2v4h-2v-2h-2v2h-2v-4h2v-2h-2v-2zm4 4v2h2v-2h-2zm-8 2h2v4H8v-4z" />
    </svg>
  );
}

type Props = {
  /** When set, show this server-assigned custodial address instead of a browser-generated keypair. */
  serverDepositAddress?: string | null;
};

export default function TestReceiveAddresses({ serverDepositAddress = null }: Props) {
  const [wallet, setWallet] = useState<AccountReceiveWallet | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(() => {
    try {
      const trimmed = serverDepositAddress?.trim();
      if (trimmed) {
        setWallet({ accountId: "custodial", solAddress: trimmed });
      } else {
        setWallet(getOrCreateAccountReceiveWallet());
      }
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load deposit address");
      setWallet(null);
    }
  }, [serverDepositAddress]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!qrOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setQrOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [qrOpen]);

  const copy = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setLoadError("Clipboard unavailable");
    }
  };

  return (
    <div style={s.wrap}>
      {loadError ? <p style={s.err}>{loadError}</p> : null}

      {wallet ? (
        <>
          <div style={s.row}>
            <p style={s.depositHint}>
              Only send <strong style={s.depositHintStrong}>USDC</strong> on the{" "}
              <strong style={s.depositHintStrong}>Solana Network</strong>
            </p>
            <div style={s.addrRow}>
              <code style={s.addr}>{wallet.solAddress}</code>
              <div style={s.actions}>
                <button
                  type="button"
                  style={s.iconBtn}
                  onClick={() => copy(wallet.solAddress)}
                  aria-label="Copy Solana address"
                  title="Copy address"
                >
                  <CopyIcon />
                </button>
                <button
                  type="button"
                  style={s.iconBtn}
                  onClick={() => setQrOpen(true)}
                  aria-label="Show Solana address QR code"
                  title="QR code"
                >
                  <QrIcon />
                </button>
              </div>
            </div>
            {copied ? <span style={s.copied}>Copied</span> : null}
          </div>
        </>
      ) : !loadError ? (
        <p style={s.muted}>Loading…</p>
      ) : null}

      {qrOpen && wallet ? (
        <div
          style={s.modalBackdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="qr-dialog-title"
          onClick={() => setQrOpen(false)}
        >
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <h4 id="qr-dialog-title" style={s.modalTitle}>
              Solana (SPL)
            </h4>
            <p style={s.modalHint}>Scan to copy receiving address (test)</p>
            <div style={s.qrBox}>
              <QRCode
                value={wallet.solAddress}
                size={220}
                style={{ width: "100%", maxWidth: 220, height: "auto" }}
              />
            </div>
            <code style={s.modalAddr}>{wallet.solAddress}</code>
            <button type="button" style={s.modalClose} onClick={() => setQrOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  wrap: { display: "flex", flexDirection: "column", gap: 14 },
  err: { margin: 0, fontSize: 13, color: "var(--danger)" },
  muted: { margin: 0, fontSize: 13, color: "var(--muted)" },
  row: { display: "flex", flexDirection: "column", gap: 8 },
  depositHint: {
    margin: 0,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid color-mix(in srgb, var(--accent) 32%, var(--border))",
    background: "color-mix(in srgb, var(--accent) 9%, var(--bg))",
    boxShadow: "inset 0 1px 0 color-mix(in srgb, var(--text) 4%, transparent)",
    fontSize: 13,
    fontWeight: 600,
    lineHeight: 1.45,
    letterSpacing: "-0.02em",
    color: "var(--text)",
  },
  depositHintStrong: {
    color: "color-mix(in srgb, var(--accent) 92%, #fff)",
    fontWeight: 700,
  },
  addrRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg)",
  },
  addr: {
    flex: "1 1 200px",
    margin: 0,
    fontSize: 12,
    lineHeight: 1.45,
    wordBreak: "break-all",
    color: "var(--text)",
  },
  actions: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 },
  iconBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
    padding: 0,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--text)",
    cursor: "pointer",
  },
  copied: { fontSize: 12, color: "var(--ok)" },
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    background: "rgba(0,0,0,0.72)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  modal: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: 20,
    maxWidth: 340,
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
  },
  modalTitle: { margin: 0, fontSize: "1rem", fontWeight: 600, color: "var(--text)" },
  modalHint: { margin: 0, fontSize: 12, color: "var(--muted)", textAlign: "center" },
  qrBox: {
    padding: 12,
    background: "#fff",
    borderRadius: 8,
  },
  modalAddr: {
    fontSize: 11,
    wordBreak: "break-all",
    textAlign: "center",
    color: "var(--muted)",
    lineHeight: 1.4,
  },
  modalClose: {
    marginTop: 4,
    background: "color-mix(in srgb, var(--accent) 16%, var(--panel))",
    border: "1px solid color-mix(in srgb, var(--accent) 40%, var(--border))",
    color: "var(--text)",
    borderRadius: 8,
    padding: "10px 20px",
    fontWeight: 600,
    cursor: "pointer",
  },
};
