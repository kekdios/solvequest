import { Connection, PublicKey } from "@solana/web3.js";

/**
 * Official public mainnet RPC. **Browser `fetch` sends `Origin`; this host returns JSON-RPC 403 when
 * `Origin` is set** — use same-origin `/solana-rpc` (Vite strips `Origin` when proxying) or a server-side caller.
 */
export const PUBLIC_MAINNET_RPC = "https://api.mainnet-beta.solana.com";

/** RFC1918 + .local — dev server often bound to 0.0.0.0 and opened via LAN IP; still has Vite `/solana-rpc` proxy. */
function isPrivateLanOrLocalHostname(hostname: string): boolean {
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".local")
  ) {
    return true;
  }
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(hostname);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/** Mainnet USDC (legacy SPL). */
export const MAINNET_USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

/** Confirmed is the usual bar for crediting; finalized is stricter. */
export const READ_COMMITMENT = "confirmed" as const;

/**
 * Resolves JSON-RPC URL for @solana/web3.js Connection.
 *
 * - **Browser + Vite dev server** (`import.meta.env.DEV`): same-origin `/solana-rpc` (proxied to mainnet; proxy strips
 *   `Origin` because api.mainnet-beta returns **403** if `Origin` is forwarded).
 *   With `VITE_SOLANA_USE_ENV_RPC_URL=1`, paid RPC URLs in `VITE_SOLANA_RPC_URL` may still **403** from the browser.
 * - **Browser + localhost / 127.0.0.1** (`vite preview`, etc.): same `/solana-rpc` proxy when available.
 * - Otherwise: `VITE_SOLANA_USE_PUBLIC_RPC=1` forces official public mainnet URL (no custom RPC).
 * - `VITE_SOLANA_RPC_URL` is used only when explicitly allowed (`VITE_SOLANA_USE_ENV_RPC_URL=1`) or on non-local production deploys.
 */
export function getSolanaRpcEndpoint(): string {
  const forcePublic =
    import.meta.env?.VITE_SOLANA_USE_PUBLIC_RPC === "1" ||
    import.meta.env?.VITE_SOLANA_USE_PUBLIC_RPC === "true";
  const fromEnv = import.meta.env?.VITE_SOLANA_RPC_URL?.trim();
  const useEnvRpcInBrowser =
    import.meta.env?.VITE_SOLANA_USE_ENV_RPC_URL === "1" ||
    import.meta.env?.VITE_SOLANA_USE_ENV_RPC_URL === "true";

  const isBrowser = typeof window !== "undefined";
  const origin = isBrowser ? window.location.origin : "";
  const host = isBrowser ? window.location.hostname : "";
  /** Vite dev, preview on LAN, or localhost — same machine serves `/solana-rpc`. */
  const useViteProxy =
    isBrowser &&
    origin.startsWith("http") &&
    (Boolean(import.meta.env.DEV) || isPrivateLanOrLocalHostname(host));

  if (useViteProxy && useEnvRpcInBrowser && fromEnv && !forcePublic) {
    return fromEnv;
  }
  if (useViteProxy) {
    return `${origin}/solana-rpc`;
  }

  if (forcePublic) {
    return PUBLIC_MAINNET_RPC;
  }

  if (!forcePublic && fromEnv) {
    return fromEnv;
  }

  return PUBLIC_MAINNET_RPC;
}

export function makeConnection(): Connection {
  return new Connection(getSolanaRpcEndpoint(), READ_COMMITMENT);
}

export function treasuryPubkey(): PublicKey | null {
  const raw = typeof import.meta !== "undefined" ? import.meta.env?.VITE_SOLANA_TREASURY_ADDRESS : undefined;
  if (!raw || typeof raw !== "string" || raw.length < 32) return null;
  try {
    return new PublicKey(raw.trim());
  } catch {
    return null;
  }
}
