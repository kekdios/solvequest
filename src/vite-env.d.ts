/// <reference types="vite/client" />

/** Ensures `import.meta.env` types when checking Node-only projects (plugins/server) that import `src/`. */
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface ImportMetaEnv {
  /** Optional; sent as `Authorization: Bearer` on info API requests. */
  readonly HYPERLIQUID_API_KEY: string;
  /** Override Hyperliquid info POST URL (default `https://api.hyperliquid.xyz/info`). */
  readonly HYPERLIQUID_INFO_URL: string;
  /** Solana JSON-RPC URL (optional). In the browser, paid URLs often 403 — local dev uses `/solana-rpc` proxy unless VITE_SOLANA_USE_ENV_RPC_URL=1. */
  readonly VITE_SOLANA_RPC_URL: string;
  /** If "1" / "true", use official public mainnet RPC URL (not custom VITE_SOLANA_RPC_URL). */
  readonly VITE_SOLANA_USE_PUBLIC_RPC: string;
  /** If "1" / "true", allow VITE_SOLANA_RPC_URL in the browser (you need CORS / browser access from the provider). */
  readonly VITE_SOLANA_USE_ENV_RPC_URL: string;
  /** Treasury Solana address for custodial sweep (USDC ATA created idempotently). */
  readonly VITE_SOLANA_TREASURY_ADDRESS: string;
  /**
   * Base64-encoded 64-byte Solana secret (same as `solSecretKeyB64` in localStorage JSON).
   * When set, overrides generated keys — for local testing only; never commit real funds.
   */
  readonly VITE_SOLANA_TEST_SECRET_KEY_B64: string;
  /** Account id used with the test secret (default `test-env`). */
  readonly VITE_SOLANA_TEST_ACCOUNT_ID: string;
  /** Hostname for admin-only UI (default `admin.solvequest.io`). */
  readonly VITE_ADMIN_HOST: string;
  /** Public origin of main site (default derived; set for local dev). */
  readonly VITE_MAIN_SITE_ORIGIN: string;
  /** Full origin of admin subdomain (default derived). */
  readonly VITE_ADMIN_ORIGIN: string;
  /** QUSD per $1 USDC (from `QUSD_MULTIPLIER` in `.env` via Vite define). */
  readonly QUSD_MULTIPLIER: string;
}
