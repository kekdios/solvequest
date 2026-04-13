/**
 * Per-account Solana custodial deposit keypair. Persisted locally; public address maps to
 * `accounts.sol_receive_address` in SQLite when synced from a backend.
 */
import { Keypair } from "@solana/web3.js";
import { clearDepositLedger } from "../deposit/depositLedger";

const STORAGE_KEY = "sq-account-receive-v2";

/** Base64-encoded 64-byte secret (`solSecretKeyB64` style). When set, overrides generated localStorage key. */
function testSecretKeyB64FromEnv(): string | null {
  const raw = import.meta.env?.VITE_SOLANA_TEST_SECRET_KEY_B64;
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

function testAccountIdFromEnv(): string {
  const raw = import.meta.env?.VITE_SOLANA_TEST_ACCOUNT_ID;
  if (typeof raw === "string" && raw.trim().length > 0) return raw.trim();
  return "test-env";
}

export type AccountReceiveWallet = {
  accountId: string;
  solAddress: string;
};

type StoredPayload = {
  accountId: string;
  solSecretKeyB64: string;
};

function bytesToB64(u8: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]!);
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function addressesFromPayload(p: StoredPayload): AccountReceiveWallet {
  const solKp = Keypair.fromSecretKey(b64ToBytes(p.solSecretKeyB64));
  return {
    accountId: p.accountId,
    solAddress: solKp.publicKey.toBase58(),
  };
}

/** Strip deprecated EVM fields and resave (Solana-only). */
function persistSolOnly(payload: StoredPayload): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function parseStored(raw: string): StoredPayload | null {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (typeof j.accountId !== "string" || typeof j.solSecretKeyB64 !== "string") return null;
    const p: StoredPayload = { accountId: j.accountId, solSecretKeyB64: j.solSecretKeyB64 };
    if ("evmPrivateKey" in j || "evmAddress" in j) {
      persistSolOnly(p);
    }
    return p;
  } catch {
    return null;
  }
}

function loadOrCreate(): AccountReceiveWallet {
  if (typeof window === "undefined" || !window.localStorage) {
    throw new Error("Receive wallet only runs in the browser");
  }

  const envSecret = testSecretKeyB64FromEnv();
  if (envSecret) {
    const solKp = Keypair.fromSecretKey(b64ToBytes(envSecret));
    return {
      accountId: testAccountIdFromEnv(),
      solAddress: solKp.publicKey.toBase58(),
    };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = parseStored(raw);
      if (p) return addressesFromPayload(p);
    }
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
  }

  const accountId = crypto.randomUUID();
  const solKp = Keypair.generate();
  const payload: StoredPayload = {
    accountId,
    solSecretKeyB64: bytesToB64(solKp.secretKey),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

  return {
    accountId,
    solAddress: solKp.publicKey.toBase58(),
  };
}

/**
 * Ensures an account id and Solana receive address exist for this browser profile.
 * Call on Account / Receive UI load.
 */
export function getOrCreateAccountReceiveWallet(): AccountReceiveWallet {
  return loadOrCreate();
}

/**
 * Row fragment matching `accounts` deposit column (no secrets). Use when syncing to SQLite.
 */
export function getReceiveAddressRowSnapshot(wallet: AccountReceiveWallet): {
  id: string;
  sol_receive_address: string;
} {
  return {
    id: wallet.accountId,
    sol_receive_address: wallet.solAddress,
  };
}

/** Dev/QA: clear stored keys and next load creates a new account id + address. */
export function resetAccountReceiveWallet(): void {
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = parseStored(raw);
        if (p) clearDepositLedger(p.accountId);
      }
    } catch {
      /* ignore */
    }
    const envSecret = testSecretKeyB64FromEnv();
    if (envSecret) {
      clearDepositLedger(testAccountIdFromEnv());
    }
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

/**
 * Loads the custodial Solana keypair from localStorage (same secret as deposit receive address).
 * Used for treasury sweeps only — never log or expose `secretKey`.
 */
export function getSolanaKeypairFromStorage(): Keypair | null {
  const envSecret = testSecretKeyB64FromEnv();
  if (envSecret) {
    try {
      return Keypair.fromSecretKey(b64ToBytes(envSecret));
    } catch {
      return null;
    }
  }
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = parseStored(raw);
    if (!p) return null;
    return Keypair.fromSecretKey(b64ToBytes(p.solSecretKeyB64));
  } catch {
    return null;
  }
}
