import { Connection, PublicKey } from "@solana/web3.js";

/**
 * Official public mainnet RPC. **Browser `fetch` sends `Origin`; this host returns JSON-RPC 403 when
 * `Origin` is set** — use same-origin `/solana-rpc` (Vite strips `Origin` when proxying) or a server-side caller.
 */
export const PUBLIC_MAINNET_RPC = "https://api.mainnet-beta.solana.com";

/** Mainnet USDC (legacy SPL). */
export const MAINNET_USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

/** Confirmed is the usual bar for crediting; finalized is stricter. */
export const READ_COMMITMENT = "confirmed" as const;

/**
 * Resolves JSON-RPC URL for @solana/web3.js Connection.
 *
 * - **Browser (dev or production):** same-origin `/solana-rpc` — Vite dev and Express prod both proxy to mainnet and
 *   strip/forbid the `Origin` header that makes `api.mainnet-beta.solana.com` return **403** to browsers.
 * - **`VITE_SOLANA_USE_ENV_RPC_URL=1`** + **`VITE_SOLANA_RPC_URL`:** use that URL in the browser (needs CORS / provider
 *   that allows browser origins).
 * - **`VITE_SOLANA_USE_PUBLIC_RPC=1`:** force the public mainnet URL (often **403** in the browser; for debugging only).
 * - **Non-browser:** `VITE_SOLANA_RPC_URL` if set, else public mainnet.
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

  if (isBrowser && origin.startsWith("http")) {
    if (useEnvRpcInBrowser && fromEnv && !forcePublic) {
      return fromEnv;
    }
    if (forcePublic) {
      return PUBLIC_MAINNET_RPC;
    }
    return `${origin}/solana-rpc`;
  }

  if (forcePublic) {
    return PUBLIC_MAINNET_RPC;
  }
  if (fromEnv) {
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
