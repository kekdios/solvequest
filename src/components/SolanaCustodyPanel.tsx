import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import { getUsdcAta, runUsdcDepositScan } from "../deposit/scanIncoming";
import { loadLedger, saveLedger, type CustodyLedger } from "../deposit/depositLedger";
import { MAINNET_USDC_MINT, READ_COMMITMENT, makeConnection } from "../deposit/chainConfig";
import { sweepCustodialToTreasury, formatLamportsSol } from "../deposit/sweepTreasury";
import { getSolanaKeypairFromStorage } from "../lib/accountReceiveAddresses";

type Props = {
  accountId: string;
  /** Credits in-app USDC wallet balance when mainnet USDC SPL arrives at the custodial ATA. */
  onUsdcCredited: (amountUsdc: number) => void;
};

export default function SolanaCustodyPanel({ accountId, onUsdcCredited }: Props) {
  const creditRef = useRef(onUsdcCredited);
  creditRef.current = onUsdcCredited;

  const [ledger, setLedger] = useState<CustodyLedger>(() => loadLedger(accountId));
  const [status, setStatus] = useState<"idle" | "scanning" | "error">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [solBal, setSolBal] = useState<number | null>(null);
  const [usdcBal, setUsdcBal] = useState<number | null>(null);
  const [sweepMsg, setSweepMsg] = useState<string | null>(null);

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
    const kp = getSolanaKeypairFromStorage();
    if (!kp) return;
    const owner = kp.publicKey;
    setStatus("scanning");
    setErrMsg(null);
    try {
      const current = loadLedger(accountId);
      const { credits, ledger: next } = await runUsdcDepositScan(owner, current);
      saveLedger(accountId, next);
      setLedger(next);
      for (const c of credits) {
        creditRef.current(c.amountUsdc);
      }
      await refreshBalances(owner);
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setErrMsg(e instanceof Error ? e.message : "Scan failed");
    }
  }, [accountId, refreshBalances]);

  useEffect(() => {
    setLedger(loadLedger(accountId));
  }, [accountId]);

  /** Load SOL/USDC balances only — deposit scan runs when you click “Scan now”. */
  useEffect(() => {
    const kp = getSolanaKeypairFromStorage();
    if (!kp) return;
    let alive = true;
    void (async () => {
      try {
        await refreshBalances(kp.publicKey);
      } catch (e) {
        if (!alive) return;
        setStatus("error");
        setErrMsg(e instanceof Error ? e.message : "RPC error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [accountId, refreshBalances]);

  const sweep = async () => {
    setSweepMsg(null);
    const kp = getSolanaKeypairFromStorage();
    if (!kp) return;
    const r = await sweepCustodialToTreasury(kp);
    if (r.ok) {
      setSweepMsg(`Sweep ok · ${r.sweptUsdc.toFixed(4)} USDC · ${formatLamportsSol(r.sweptSolLamports)} SOL`);
      await refreshBalances(kp.publicKey);
    } else {
      setSweepMsg(r.reason);
    }
  };

  const creditedList = Object.entries(ledger.creditedSignatures)
    .sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0))
    .slice(0, 12);

  return (
    <div style={s.box}>
      <h4 style={s.h4}>Solana custody (mainnet)</h4>
      <p style={s.p}>
        Unique deposit keypair per account; USDC SPL uses the standard ATA for mint{" "}
        <code style={s.code}>{MAINNET_USDC_MINT.toBase58().slice(0, 6)}…</code>. Use <strong>Scan now</strong> to check
        for new deposits. In production, USDC→QUSD credits are applied when an admin runs{" "}
        <strong>Run server deposit scan</strong> (or enable background{" "}
        <code style={s.code}>SOLVEQUEST_DEPOSIT_SCAN=1</code>). This panel is for debugging / treasury sweep only.
      </p>
      {errMsg && /403|forbidden/i.test(errMsg) ? (
        <p style={s.rpcHint}>
          RPC returned 403 — public mainnet often rejects browser <code style={s.code}>Origin</code> headers; local dev
          should use same-origin <code style={s.code}>/solana-rpc</code> (Vite strips <code style={s.code}>Origin</code>{" "}
          when proxying). Do not set <code style={s.code}>VITE_SOLANA_USE_ENV_RPC_URL=1</code> unless your RPC allows
          browser origins. Restart the dev server after changing <code style={s.code}>.env</code>.
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
        <button type="button" style={s.btnGhost} onClick={() => void sweep()}>
          Sweep to treasury
        </button>
      </div>
      {sweepMsg ? <p style={s.sweep}>{sweepMsg}</p> : null}
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
  btnGhost: {
    background: "transparent",
    border: "1px solid var(--border)",
    color: "var(--muted)",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 12,
    cursor: "pointer",
  },
  sweep: { margin: "8px 0 0", fontSize: 12, color: "var(--ok)" },
  credits: { marginTop: 10 },
  creditsTitle: { margin: "0 0 6px", fontSize: 11, fontWeight: 600, color: "var(--muted)" },
  ul: { margin: 0, paddingLeft: 18, fontSize: 11, color: "var(--muted)" },
  li: { marginBottom: 4 },
  sig: { color: "var(--text)" },
};
