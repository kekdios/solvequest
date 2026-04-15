import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider, WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import {
  fetchAdminCustodyDebug,
  fetchAdminMe,
  fetchAdminNonce,
  fetchAdminSweepFeePayerInfo,
  postAdminCustodialSweep,
  postAdminDepositScan,
  postAdminLogout,
  postAdminVerify,
  type AdminCustodialSweepResponse,
  type AdminCustodyDebugResponse,
  type AdminSweepFeePayerInfoResponse,
  uint8ToBase64,
} from "../lib/adminApi";
import { getSolanaRpcEndpoint } from "../deposit/chainConfig";
import { uiBtnGhost, uiBtnPrimary, uiOrderCard, uiPageH2 } from "../ui/appSurface";
import SolanaCustodyPanel from "../components/SolanaCustodyPanel";

import "@solana/wallet-adapter-react-ui/styles.css";

type Props = {
  onNavigateHome: () => void;
  /** Legacy hook — USDC→QUSD credits are applied server-side by the deposit worker. */
  onCustodialUsdcCredited: (amountUsdc: number) => void;
};

const CUSTODY_OWNER_STORAGE = "sq_admin_custody_owner";

function AdminSolanaCustody({
  onUsdcCredited,
}: {
  onUsdcCredited: (amountUsdc: number) => void;
}) {
  const debugPk = import.meta.env.VITE_SOLANA_DEBUG_CUSTODY_PUBKEY?.trim() || null;
  const [custodyOwnerDraft, setCustodyOwnerDraft] = useState(() => {
    if (typeof sessionStorage === "undefined") return "";
    try {
      return sessionStorage.getItem(CUSTODY_OWNER_STORAGE) ?? "";
    } catch {
      return "";
    }
  });

  const [serverSnap, setServerSnap] = useState<AdminCustodyDebugResponse | null>(null);
  const [serverSnapLoading, setServerSnapLoading] = useState(true);
  const [serverSnapErr, setServerSnapErr] = useState<string | null>(null);

  const [feePayerInfo, setFeePayerInfo] = useState<AdminSweepFeePayerInfoResponse | null>(null);
  const [feePayerErr, setFeePayerErr] = useState<string | null>(null);

  const loadServerSnap = useCallback(() => {
    setServerSnapLoading(true);
    setServerSnapErr(null);
    setFeePayerErr(null);
    void Promise.all([fetchAdminCustodyDebug(), fetchAdminSweepFeePayerInfo()])
      .then(([snap, fee]) => {
        setServerSnap(snap);
        setFeePayerInfo(fee);
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        setServerSnapErr(msg);
        setFeePayerErr(msg);
      })
      .finally(() => setServerSnapLoading(false));
  }, []);

  useEffect(() => {
    void loadServerSnap();
  }, [loadServerSnap]);

  useEffect(() => {
    try {
      sessionStorage.setItem(CUSTODY_OWNER_STORAGE, custodyOwnerDraft);
    } catch {
      /* ignore */
    }
  }, [custodyOwnerDraft]);

  /** Optional paste / VITE wins; else server-configured owner from SOLVEQUEST_ADMIN_CUSTODY_OWNER. */
  const ownerForPanel = custodyOwnerDraft.trim() || serverSnap?.owner || debugPk || null;

  return (
    <>
      <div style={s.custodyServerCard}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h3 style={s.custodyServerH3}>Custody (server RPC)</h3>
          <button type="button" style={s.custodyRefreshBtn} disabled={serverSnapLoading} onClick={() => loadServerSnap()}>
            {serverSnapLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {serverSnapLoading && !serverSnap ? (
          <p style={s.custodyHint}>Loading snapshot…</p>
        ) : serverSnapErr ? (
          <p style={s.err}>{serverSnapErr}</p>
        ) : serverSnap && !serverSnap.configured ? (
          <p style={s.custodyHint}>
            Set <code style={s.inlineCode}>SOLVEQUEST_ADMIN_CUSTODY_OWNER</code> in the <strong>server</strong>{" "}
            <code style={s.inlineCode}>.env</code> to your custodial deposit <strong>owner</strong> (same base58 as{" "}
            <code style={s.inlineCode}>sol_receive_address</code> / HD deposit wallet — not your admin signing wallet).
            Restart the API process. Optional: <code style={s.inlineCode}>SOLANA_RPC_URL</code> for RPC.
          </p>
        ) : serverSnap?.configured && serverSnap.owner ? (
          <>
            {serverSnap.rpc_error ? (
              <p style={s.err} role="alert">
                RPC: {serverSnap.rpc_error}
              </p>
            ) : null}
            <p style={s.custodyMono}>
              <span style={s.custodyK}>Owner</span> {serverSnap.owner}
            </p>
            <p style={s.custodyMono}>
              <span style={s.custodyK}>USDC ATA</span> {serverSnap.usdc_ata}
            </p>
            <p style={s.custodyMono}>
              <span style={s.custodyK}>SOL</span>{" "}
              {serverSnap.sol_lamports == null ? "—" : (serverSnap.sol_lamports / LAMPORTS_PER_SOL).toFixed(6)}
            </p>
            <p style={s.custodyMono}>
              <span style={s.custodyK}>USDC</span>{" "}
              {serverSnap.usdc_balance_ui == null ? "—" : serverSnap.usdc_balance_ui.toFixed(4)}{" "}
              {!serverSnap.ata_exists ? "(ATA not created yet)" : null}
            </p>
            <p style={{ ...s.custodyHint, marginTop: 8 }}>
              RPC: <code style={s.inlineCode}>{serverSnap.rpc_url}</code>
            </p>
            {serverSnap.recent_signatures.length > 0 ? (
              <div style={{ marginTop: 12 }}>
                <p style={s.custodySigTitle}>Recent ATA transactions</p>
                <ul style={s.custodySigUl}>
                  {serverSnap.recent_signatures.map((row) => (
                    <li key={row.signature} style={s.custodySigLi}>
                      <a
                        href={`https://solscan.io/tx/${row.signature}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={s.custodySigA}
                      >
                        {row.signature.slice(0, 12)}…
                      </a>
                      {row.blockTime != null ? (
                        <span style={s.custodySigMeta}>{new Date(row.blockTime * 1000).toISOString()}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p style={{ ...s.custodyHint, marginTop: 8 }}>No signatures yet for this USDC ATA.</p>
            )}
          </>
        ) : null}
      </div>

      <div style={s.custodyServerCard}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h3 style={s.custodyServerH3}>Sweep fee payer (fund with SOL)</h3>
          <button type="button" style={s.custodyRefreshBtn} disabled={serverSnapLoading} onClick={() => loadServerSnap()}>
            {serverSnapLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {feePayerErr && !feePayerInfo ? (
          <p style={s.err}>{feePayerErr}</p>
        ) : feePayerInfo?.mode === "custodial_pays" ? (
          <p style={s.custodyHint}>
            Central fee payer is <strong>off</strong>. Each custodial <code style={s.inlineCode}>sol_receive_address</code>{" "}
            pays its own tx fees, or set <code style={s.inlineCode}>SOLANA_SWEEP_FEE_PAYER_KEY_B64</code> or{" "}
            <code style={s.inlineCode}>SOLANA_SWEEP_FEE_PAYER_FROM_MASTER=1</code> on the server.
          </p>
        ) : feePayerInfo?.mode === "config_error" ? (
          <p style={s.err} role="alert">
            {feePayerInfo.message}
          </p>
        ) : feePayerInfo && (feePayerInfo.mode === "explicit" || feePayerInfo.mode === "from_master") ? (
          <>
            <p style={s.custodyHint}>
              {feePayerInfo.mode === "from_master" ? (
                <>
                  Derived from <code style={s.inlineCode}>SOLANA_CUSTODIAL_MASTER_KEY_B64</code> at reserved HD path (same
                  entropy as deposits; fund this pubkey for sweep fees).
                </>
              ) : (
                <>From <code style={s.inlineCode}>SOLANA_SWEEP_FEE_PAYER_KEY_B64</code>.</>
              )}
            </p>
            {feePayerInfo.mode === "from_master" ? (
              <p style={{ ...s.custodyMono, marginTop: 6 }}>
                <span style={s.custodyK}>Path</span> {feePayerInfo.path}
              </p>
            ) : null}
            <p style={{ ...s.custodyMono, marginTop: 6 }}>
              <span style={s.custodyK}>Pubkey</span>{" "}
              <a
                href={`https://solscan.io/account/${feePayerInfo.pubkey}`}
                target="_blank"
                rel="noopener noreferrer"
                style={s.custodySigA}
              >
                {feePayerInfo.pubkey}
              </a>
            </p>
            <p style={s.custodyMono}>
              <span style={s.custodyK}>SOL balance</span>{" "}
              {feePayerInfo.sol_lamports == null
                ? feePayerInfo.rpc_error
                  ? `— (${feePayerInfo.rpc_error})`
                  : "—"
                : `${(feePayerInfo.sol_lamports / LAMPORTS_PER_SOL).toFixed(6)}`}
            </p>
            <p style={{ ...s.custodyHint, marginTop: 8 }}>
              RPC: <code style={s.inlineCode}>{feePayerInfo.rpc_url}</code>
            </p>
          </>
        ) : (
          <p style={s.custodyHint}>Loading…</p>
        )}
      </div>

      <div style={s.custodyField}>
        <label htmlFor="sq-admin-custody-owner" style={s.custodyLabel}>
          Override owner (optional)
        </label>
        <input
          id="sq-admin-custody-owner"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="Leave empty to use server env or VITE_SOLANA_DEBUG_CUSTODY_PUBKEY"
          value={custodyOwnerDraft}
          onChange={(e) => setCustodyOwnerDraft(e.target.value)}
          style={s.custodyInput}
        />
        <p style={s.custodyHint}>
          Browser panel below uses this field, then <code style={s.inlineCode}>SOLVEQUEST_ADMIN_CUSTODY_OWNER</code>, then{" "}
          <code style={s.inlineCode}>VITE_SOLANA_DEBUG_CUSTODY_PUBKEY</code>. Admin sign-in wallet is unrelated.
        </p>
      </div>
      <SolanaCustodyPanel
        accountId="admin-deposit-ledger"
        ownerPubkeyBase58={ownerForPanel}
        onUsdcCredited={onUsdcCredited}
      />
    </>
  );
}

function AdminScreenInner({ onNavigateHome, onCustodialUsdcCredited }: Props) {
  const { publicKey, signMessage, connected, connecting, disconnect } = useWallet();
  const [me, setMe] = useState<{ authenticated: boolean; pubkey?: string } | null>(null);
  const [loadingMe, setLoadingMe] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverScanBusy, setServerScanBusy] = useState(false);
  const [serverScanMsg, setServerScanMsg] = useState<string | null>(null);
  const [sweepBusy, setSweepBusy] = useState(false);
  const [sweepAccountId, setSweepAccountId] = useState("");
  const [sweepResult, setSweepResult] = useState<AdminCustodialSweepResponse | null>(null);
  const [sweepError, setSweepError] = useState<string | null>(null);
  const [sweepRevealN, setSweepRevealN] = useState(0);

  useEffect(() => {
    if (!sweepResult?.steps?.length) {
      setSweepRevealN(0);
      return;
    }
    setSweepRevealN(0);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setSweepRevealN(Math.min(i, sweepResult.steps.length));
      if (i >= sweepResult.steps.length) window.clearInterval(id);
    }, 200);
    return () => window.clearInterval(id);
  }, [sweepResult]);

  const refreshMe = useCallback(() => {
    setLoadingMe(true);
    fetchAdminMe()
      .then((r) => {
        if (r.authenticated && r.pubkey) {
          setMe({ authenticated: true, pubkey: r.pubkey });
        } else {
          setMe({ authenticated: false });
        }
      })
      .catch(() => setMe({ authenticated: false }))
      .finally(() => setLoadingMe(false));
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  const onSignIn = async () => {
    setError(null);
    if (!publicKey || !signMessage) {
      setError("Connect a wallet that supports message signing.");
      return;
    }
    setSigningIn(true);
    try {
      const { nonce, message } = await fetchAdminNonce();
      const encoded = new TextEncoder().encode(message);
      const sig = await signMessage(encoded);
      await postAdminVerify({
        nonce,
        message,
        pubkey: publicKey.toBase58(),
        signature: uint8ToBase64(sig),
      });
      refreshMe();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setSigningIn(false);
    }
  };

  const onLogout = async () => {
    setError(null);
    try {
      await postAdminLogout();
      await disconnect();
      refreshMe();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Logout failed");
    }
  };

  if (loadingMe) {
    return (
      <div className="app-page">
        <p style={s.muted}>Checking session…</p>
      </div>
    );
  }

  if (me?.authenticated && me.pubkey) {
    return (
      <div className="app-page" style={s.wrap}>
        <section style={s.card}>
          <h2 style={s.h2}>Signed in</h2>
          <p style={s.p}>
            Admin wallet: <span className="mono" style={s.code}>{me.pubkey}</span>
          </p>
          <p style={s.muted}>
            This session is stored in an httpOnly cookie for this origin. Add operational tools here (metrics, user
            list, etc.).
          </p>
          <div style={{ ...s.row, alignItems: "flex-start", flexDirection: "column" }}>
            <button
              type="button"
              style={s.btn}
              disabled={serverScanBusy}
              onClick={() => {
                setServerScanMsg(null);
                setServerScanBusy(true);
                void postAdminDepositScan()
                  .then((r) => {
                    setServerScanMsg(`Server scan finished · ${r.accountsScanned} account(s) with deposit addresses checked.`);
                  })
                  .catch((e: unknown) => {
                    setServerScanMsg(e instanceof Error ? e.message : "Server scan failed");
                  })
                  .finally(() => setServerScanBusy(false));
              }}
            >
              {serverScanBusy ? "Scanning…" : "Run server deposit scan"}
            </button>
            {serverScanMsg ? (
              <p style={{ ...s.muted, margin: "8px 0 0", fontSize: 13 }}>{serverScanMsg}</p>
            ) : null}
          </div>

          <div style={{ ...s.row, alignItems: "flex-start", flexDirection: "column", marginTop: 20 }}>
            <h3 style={s.sweepH3}>Custodial USDC sweep</h3>
            <p style={{ ...s.muted, margin: "0 0 8px", fontSize: 13, maxWidth: 560 }}>
              Syncs deposits (QUSD), confirms on-chain USDC and ledger credits, then sweeps USDC to treasury (
              <code style={s.inlineCode}>SOLANA_TREASURY_ADDRESS</code> / <code style={s.inlineCode}>VITE_SOLANA_TREASURY_ADDRESS</code>
              ). Uses <code style={s.inlineCode}>SOLVEQUEST_ADMIN_CUSTODY_OWNER</code> to find the account unless you pass a
              UUID below.
            </p>
            <label htmlFor="sq-sweep-account" style={s.custodyLabel}>
              Account id (optional)
            </label>
            <input
              id="sq-sweep-account"
              type="text"
              placeholder="Leave empty to use SOLVEQUEST_ADMIN_CUSTODY_OWNER"
              value={sweepAccountId}
              onChange={(e) => setSweepAccountId(e.target.value)}
              style={{ ...s.custodyInput, maxWidth: 480 }}
            />
            <button
              type="button"
              style={s.btn}
              disabled={sweepBusy || serverScanBusy}
              onClick={() => {
                setSweepError(null);
                setSweepResult(null);
                setSweepBusy(true);
                void postAdminCustodialSweep(sweepAccountId.trim() ? { account_id: sweepAccountId.trim() } : {})
                  .then(setSweepResult)
                  .catch((e: unknown) => setSweepError(e instanceof Error ? e.message : "Sweep request failed"))
                  .finally(() => setSweepBusy(false));
              }}
            >
              {sweepBusy ? "Running sweep pipeline…" : "Run custodial sweep (guided)"}
            </button>
            {sweepBusy ? (
              <p style={{ ...s.muted, margin: "10px 0 0", fontSize: 12 }}>Contacting server — checking USDC, ledger, treasury…</p>
            ) : null}
            {sweepError ? (
              <p style={s.err} role="alert">
                {sweepError}
              </p>
            ) : null}
            {sweepResult ? (
              <div style={s.sweepOutcome}>
                <p style={{ ...s.muted, margin: "0 0 8px", fontSize: 13 }}>
                  {sweepResult.ok ? (
                    <span style={{ color: "var(--accent)" }}>Pipeline finished successfully.</span>
                  ) : (
                    <span style={{ color: "#f87171" }}>{sweepResult.error}</span>
                  )}
                </p>
                <ol style={s.sweepOl}>
                  {sweepResult.steps.slice(0, sweepRevealN).map((st, idx) => (
                    <li key={`${st.id}-${idx}`} style={s.sweepLi}>
                      <span style={st.status === "ok" ? s.sweepOk : st.status === "error" ? s.sweepBad : s.sweepSkip}>
                        {st.status === "ok" ? "✓" : st.status === "error" ? "✗" : "○"}
                      </span>{" "}
                      <strong>{st.label}</strong>
                      {st.detail ? <span style={s.sweepDetail}> — {st.detail}</span> : null}
                    </li>
                  ))}
                </ol>
                {sweepResult.ok && sweepResult.sweep_signature ? (
                  <p style={{ ...s.muted, margin: "10px 0 0", fontSize: 12 }}>
                    Solscan:{" "}
                    <a
                      href={`https://solscan.io/tx/${sweepResult.sweep_signature}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--accent)" }}
                    >
                      {sweepResult.sweep_signature.slice(0, 16)}…
                    </a>
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div style={s.row}>
            <button type="button" style={s.btnGhost} onClick={() => void onLogout()}>
              Sign out
            </button>
            <button type="button" style={s.btn} onClick={onNavigateHome}>
              Back to app
            </button>
          </div>
        </section>
        <section style={{ ...s.card, marginTop: 16 }}>
          <AdminSolanaCustody onUsdcCredited={onCustodialUsdcCredited} />
        </section>
      </div>
    );
  }

  return (
    <div className="app-page" style={s.wrap}>
      <section style={s.card}>
        <h2 style={s.h2}>Admin sign-in</h2>
        <p style={s.p}>
          Connect the Solana wallet whose public key matches <strong style={{ color: "var(--text)" }}>ADMIN_SOLANA_ADDRESS</strong>{" "}
          in the server environment, then sign the one-time message.
        </p>
        <div style={s.walletRow}>
          <WalletMultiButton />
        </div>
        <div style={s.row}>
          <button
            type="button"
            style={s.btn}
            disabled={!connected || !publicKey || connecting || signingIn}
            onClick={() => void onSignIn()}
          >
            {signingIn ? "Signing…" : "Sign message & continue"}
          </button>
        </div>
        {error ? (
          <p style={s.err} role="alert">
            {error}
          </p>
        ) : null}
        <p style={s.hint}>
          Use Phantom, Solflare, or another adapter-listed wallet. If <code style={s.inlineCode}>/api/admin</code>{" "}
          returns 503, set <code style={s.inlineCode}>ADMIN_SOLANA_ADDRESS</code> in <code style={s.inlineCode}>.env</code>{" "}
          and restart the dev server.
        </p>
      </section>
    </div>
  );
}

export default function AdminScreen(props: Props) {
  const rpcEndpoint = useMemo(() => getSolanaRpcEndpoint(), []);
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  return (
    <ConnectionProvider endpoint={rpcEndpoint}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>
          <AdminScreenInner {...props} />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

const s: Record<string, CSSProperties> = {
  wrap: { maxWidth: 720 },
  card: {
    ...uiOrderCard,
    padding: "24px 22px",
  },
  h2: { ...uiPageH2, margin: "0 0 12px" },
  p: { margin: "0 0 16px", fontSize: 14, lineHeight: 1.55, color: "var(--muted)" },
  muted: { color: "var(--muted)", fontSize: 14 },
  code: { fontSize: 13, wordBreak: "break-all", color: "var(--accent)" },
  row: { display: "flex", flexWrap: "wrap", gap: 12, marginTop: 16, alignItems: "center" },
  walletRow: { marginTop: 12, marginBottom: 8 },
  btn: {
    ...uiBtnPrimary,
  },
  btnGhost: {
    ...uiBtnGhost,
    padding: "10px 18px",
  },
  err: { marginTop: 12, fontSize: 14, color: "#f87171" },
  hint: { marginTop: 20, fontSize: 12, lineHeight: 1.5, color: "var(--muted)" },
  inlineCode: { fontFamily: "var(--mono)", fontSize: 12, color: "var(--text)" },
  custodyErr: { margin: 0, fontSize: 14, color: "#f87171" },
  custodyField: { marginBottom: 14 },
  custodyLabel: { display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 6 },
  custodyInput: {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    fontSize: 13,
    fontFamily: "var(--mono)",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--panel)",
    color: "var(--text)",
  },
  custodyHint: { margin: "8px 0 0", fontSize: 11, lineHeight: 1.5, color: "var(--muted)" },
  custodyServerCard: {
    marginBottom: 16,
    padding: "16px 14px",
    borderRadius: 10,
    border: "1px solid color-mix(in srgb, var(--accent) 28%, var(--border))",
    background: "color-mix(in srgb, var(--accent) 6%, var(--bg))",
  },
  custodyServerH3: { margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text)" },
  custodyRefreshBtn: {
    ...uiBtnGhost,
    padding: "6px 12px",
    fontSize: 12,
  },
  custodyMono: { margin: "6px 0 0", fontSize: 12, lineHeight: 1.45, wordBreak: "break-all", fontFamily: "var(--mono)" },
  custodyK: { color: "var(--muted)", marginRight: 8, fontFamily: "inherit" },
  custodySigTitle: { margin: "0 0 6px", fontSize: 11, fontWeight: 600, color: "var(--muted)" },
  custodySigUl: { margin: 0, paddingLeft: 0, listStyle: "none", fontSize: 11 },
  custodySigLi: { marginBottom: 6, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "baseline" },
  custodySigA: { color: "var(--accent)" },
  custodySigMeta: { color: "var(--muted)", fontSize: 10 },
  sweepH3: { margin: "0 0 4px", fontSize: 15, fontWeight: 600, color: "var(--text)" },
  sweepOutcome: { marginTop: 12, width: "100%", maxWidth: 560 },
  sweepOl: { margin: 0, paddingLeft: 22, fontSize: 13, lineHeight: 1.55, color: "var(--text)" },
  sweepLi: { marginBottom: 8 },
  sweepOk: { color: "#4ade80", marginRight: 6, fontWeight: 700 },
  sweepBad: { color: "#f87171", marginRight: 6, fontWeight: 700 },
  sweepSkip: { color: "var(--muted)", marginRight: 6, fontWeight: 700 },
  sweepDetail: { color: "var(--muted)", fontWeight: 400 },
};
