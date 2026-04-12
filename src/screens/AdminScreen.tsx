import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider, WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import {
  fetchAdminMe,
  fetchAdminNonce,
  postAdminLogout,
  postAdminVerify,
  uint8ToBase64,
} from "../lib/adminApi";
import { getSolanaRpcEndpoint } from "../deposit/chainConfig";
import { uiBtnGhost, uiBtnPrimary, uiOrderCard, uiPageH2 } from "../ui/appSurface";
import { getOrCreateAccountReceiveWallet } from "../lib/accountReceiveAddresses";
import SolanaCustodyPanel from "../components/SolanaCustodyPanel";

import "@solana/wallet-adapter-react-ui/styles.css";

type Props = {
  onNavigateHome: () => void;
  /** When mainnet USDC SPL is detected at the custodial ATA, credit in-app wallet (same as Account). */
  onCustodialUsdcCredited: (amountUsdc: number) => void;
};

function AdminSolanaCustody({
  onUsdcCredited,
}: {
  onUsdcCredited: (amountUsdc: number) => void;
}) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setAccountId(getOrCreateAccountReceiveWallet().accountId);
      setLoadError(null);
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : "Could not load deposit account");
      setAccountId(null);
    }
  }, []);

  if (loadError) {
    return (
      <p style={s.custodyErr} role="alert">
        {loadError}
      </p>
    );
  }
  if (!accountId) {
    return <p style={s.muted}>Loading custody…</p>;
  }
  return <SolanaCustodyPanel accountId={accountId} onUsdcCredited={onUsdcCredited} />;
}

function AdminScreenInner({ onNavigateHome, onCustodialUsdcCredited }: Props) {
  const { publicKey, signMessage, connected, connecting, disconnect } = useWallet();
  const [me, setMe] = useState<{ authenticated: boolean; pubkey?: string } | null>(null);
  const [loadingMe, setLoadingMe] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
};
