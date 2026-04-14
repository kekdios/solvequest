import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import { getUsdcAta, runUsdcDepositScan } from "../deposit/scanIncoming";
import { loadLedger, saveLedger, type CustodyLedger } from "../deposit/depositLedger";
import { MAINNET_USDC_MINT, READ_COMMITMENT, makeConnection } from "../deposit/chainConfig";

type Props = {
  /** Namespaces local deposit ledger (e.g. admin debug). */
  accountId: string;
  /** Mainnet deposit **owner** (same as `sol_receive_address` / HD-derived wallet), not the admin signing wallet. */
  ownerPubkeyBase58: string | null;
  /** Credits in-app USDC wallet balance when mainnet USDC SPL arrives at the custodial ATA. */
  onUsdcCredited: (amountUsdc: number) => void;
};

function parseOwnerPk(
  ownerPubkeyBase58: string | null,
): { ownerPk: PublicKey | null; invalid: boolean } {
  const t = ownerPubkeyBase58?.trim();
  if (!t) return { ownerPk: null, invalid: false };
  try {
    return { ownerPk: new PublicKey(t), invalid: false };
  } catch {
    return { ownerPk: null, invalid: true };
  }
}

export default function SolanaCustodyPanel({ accountId, ownerPubkeyBase58, onUsdcCredited }: Props) {
  const creditRef = useRef(onUsdcCredited);
  creditRef.current = onUsdcCredited;

  const [ledger, setLedger] = useState<CustodyLedger>(() => loadLedger(accountId));
  const [status, setStatus] = useState<"idle" | "scanning" | "error">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [solBal, setSolBal] = useState<number | null>(null);
  const [usdcBal, setUsdcBal] = useState<number | null>(null);

  const { ownerPk, invalid } = parseOwnerPk(ownerPubkeyBase58);

  const refreshBalances = useCallback(async (owner: PublicKey) => {
    const connection = makeConnection();
    const lamports = await connection.getBalance(owner, READ_COMMITMENT);
    setSolBal(lamports);
    const ata = getUsdcAta(owner);
    try {
      const acc = await getAccount(connection, ata, READ_COMMITMENT);
      setUsdcBal(Number(acc.amount) / 1e6);
    } catch {
      setUsdcBal(0);
    }
  }, []);

  const runScan = useCallback(async () => {
    if (!ownerPk) return;
    setStatus("scanning");
    setErrMsg(null);
    try {
      const current = loadLedger(accountId);
      const { credits, ledger: next } = await runUsdcDepositScan(ownerPk, current);
      saveLedger(accountId, next);
      setLedger(next);
      for (const c of credits) {
        creditRef.current(c.amountUsdc);
      }
      await refreshBalances(ownerPk);
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setErrMsg(e instanceof Error ? e.message : "Scan failed");
    }
  }, [accountId, ownerPk, refreshBalances]);

  useEffect(() => {
    setLedger(loadLedger(accountId));
  }, [accountId]);

  useEffect(() => {
    if (!ownerPk) return;
    let alive = true;
    void (async () => {
      try {
        await refreshBalances(ownerPk);
      } catch (e) {
        if (!alive) return;
        setStatus("error");
        setErrMsg(e instanceof Error ? e.message : "RPC error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [accountId, ownerPk, refreshBalances]);

  const creditedList = Object.entries(ledger.creditedSignatures)
    .sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0))
    .slice(0, 12);

  if (invalid) {
    return (
      <div style={s.box}>
        <h4 style={s.h4}>Solana custody (mainnet)</h4>
        <p style={s.err}>
          Invalid base58 public key — paste the custodial owner address (same as user <code style={s.code}>sol_receive_address</code>
          ).
        </p>
      </div>
    );
  }

  if (!ownerPubkeyBase58?.trim() || !ownerPk) {
    return (
      <div style={s.box}>
        <h4 style={s.h4}>Solana custody (mainnet)</h4>
        <p style={s.p}>
          Paste the <strong>custodial deposit owner</strong> above (the user&apos;s <code style={s.code}>sol_receive_address</code>
          — not your admin signing wallet). Or set <code style={s.code}>VITE_SOLANA_DEBUG_CUSTODY_PUBKEY</code> in{" "}
          <code style={s.code}>.env</code>. Chain USDC is read from the USDC ATA for that owner.
        </p>
      </div>
    );
  }

  return (
    <div style={s.box}>
      <h4 style={s.h4}>Solana custody (mainnet)</h4>
      <p style={s.p}>
        <span className="mono" style={{ fontSize: 11, color: "var(--text)" }}>{ownerPk.toBase58()}</span>
      </p>
      <p style={s.p}>
        USDC SPL uses the standard ATA for mint <code style={s.code}>{MAINNET_USDC_MINT.toBase58().slice(0, 6)}…</code>.
        Balances below are <strong>on-chain</strong> for this owner. Use <strong>Scan now</strong> for a local browser
        ledger check only. Production USDC→QUSD credits run on the server (
        <code style={s.code}>SOLVEQUEST_DEPOSIT_SCAN</code> or <strong>Run server deposit scan</strong>). Treasury sweep
        runs on the server only.
      </p>
      {errMsg && /403|forbidden/i.test(errMsg) ? (
        <p style={s.rpcHint}>
          RPC returned 403 — public mainnet often rejects browser <code style={s.code}>Origin</code> headers; local dev
          should use same-origin <code style={s.code}>/solana-rpc</code> (Vite strips <code style={s.code}>Origin</code>{" "}
          when proxying).
        </p>
      ) : null}
      <div style={s.row}>
        <span style={s.muted}>Chain SOL</span>
        <span className="mono">{solBal === null ? "—" : (solBal / LAMPORTS_PER_SOL).toFixed(6)}</span>
      </div>
      <div style={s.row}>
        <span style={s.muted}>Chain USDC (ATA)</span>
        <span className="mono">{usdcBal === null ? "—" : usdcBal.toFixed(4)}</span>
      </div>
      <div style={s.row}>
        <span style={s.muted}>Scanner</span>
        <span style={{ color: status === "error" ? "var(--danger)" : "var(--muted)" }}>
          {status === "scanning" ? "Scanning…" : status === "error" ? errMsg ?? "Error" : "Idle"}
        </span>
      </div>
      <div style={s.actions}>
        <button type="button" style={s.btn} onClick={() => void runScan()}>
          Scan now
        </button>
      </div>
      {creditedList.length > 0 ? (
        <div style={s.credits}>
          <p style={s.creditsTitle}>Credited (signature log)</p>
          <ul style={s.ul}>
            {creditedList.map(([sig, m]) => (
              <li key={sig} style={s.li}>
                <span className="mono" style={s.sig}>
                  {sig.slice(0, 10)}…
                </span>{" "}
                · {m.kind} ·{" "}
                {m.amountHuman != null ? `${m.amountHuman.toFixed(4)} USDC` : "—"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  err: { margin: 0, fontSize: 13, color: "#f87171", lineHeight: 1.45 },
  box: {
    marginTop: 12,
    padding: "14px 14px",
    borderRadius: 10,
    border: "1px solid color-mix(in srgb, var(--accent) 22%, var(--border))",
    background: "color-mix(in srgb, var(--accent) 5%, var(--bg))",
  },
  h4: { margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: "var(--muted)" },
  p: { margin: "0 0 10px", fontSize: 12, lineHeight: 1.5, color: "var(--muted)" },
  rpcHint: {
    margin: "0 0 10px",
    padding: "10px 12px",
    fontSize: 11,
    lineHeight: 1.45,
    color: "var(--warn)",
    borderRadius: 8,
    border: "1px solid color-mix(in srgb, var(--warn) 35%, var(--border))",
    background: "color-mix(in srgb, var(--warn) 8%, var(--bg))",
  },
  code: { fontSize: 11, color: "var(--text)" },
  row: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    fontSize: 12,
    marginBottom: 6,
  },
  muted: { color: "var(--muted)" },
  actions: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 },
  btn: {
    background: "color-mix(in srgb, var(--accent) 14%, var(--panel))",
    border: "1px solid color-mix(in srgb, var(--accent) 40%, var(--border))",
    color: "var(--text)",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  credits: { marginTop: 10 },
  creditsTitle: { margin: "0 0 6px", fontSize: 11, fontWeight: 600, color: "var(--muted)" },
  ul: { margin: 0, paddingLeft: 18, fontSize: 11, color: "var(--muted)" },
  li: { marginBottom: 4 },
  sig: { color: "var(--text)" },
};
