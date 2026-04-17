/**
 * Resolves the key that controls SOLANA_TREASURY_ADDRESS for signing (e.g. USDC swap sends).
 *
 * Precedence:
 * 1. **SOLANA_TREASURY_KEY_B64** — base64 of raw key bytes. Supported shapes after decode:
 *    - **64 bytes** — `Keypair.fromSecretKey` (standard JSON keypair file bytes).
 *    - **32 bytes** — `Keypair.fromSeed` (32-byte seed only).
 *    - **66 bytes** — try 64-byte secret at offset 0 or 2 (some exports add a 2-byte prefix).
 *    Public key must match SOLANA_TREASURY_ADDRESS.
 * 2. **SOLANA_TREASURY_DERIVATION_INDEX** — HD path m/44'/501'/<n>'/0' from **SOLANA_CUSTODIAL_MASTER_KEY_B64** (treasury HD only).
 * 3. Scan indices 0 .. SOLANA_TREASURY_MAX_SCAN−1 (default 50_000).
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  RESERVED_SWEEP_FEE_PAYER_DERIVATION_INDEX,
  deriveHdKeypairFromIndex,
} from "./solanaHdDerive";

const DEFAULT_MAX_SCAN = 50_000;

function treasuryPubkeyFromEnv(env: NodeJS.ProcessEnv): PublicKey | null {
  const s = (env.SOLANA_TREASURY_ADDRESS ?? "").trim();
  if (!s) return null;
  try {
    return new PublicKey(s);
  } catch {
    return null;
  }
}

function tryKeypairsFromDecodedSecret(raw: Buffer): Keypair[] {
  const candidates: Keypair[] = [];
  const push = (kp: Keypair) => {
    candidates.push(kp);
  };
  if (raw.length >= 64) {
    try {
      push(Keypair.fromSecretKey(Uint8Array.from(raw.subarray(0, 64))));
    } catch {
      /* try other shapes */
    }
  }
  if (raw.length >= 66) {
    try {
      push(Keypair.fromSecretKey(Uint8Array.from(raw.subarray(2, 66))));
    } catch {
      /* */
    }
  }
  if (raw.length >= 32) {
    try {
      push(Keypair.fromSeed(Uint8Array.from(raw.subarray(0, 32))));
    } catch {
      /* */
    }
  }
  return candidates;
}

function keypairFromTreasurySecretB64(
  env: NodeJS.ProcessEnv,
  treasuryPk: PublicKey,
): { ok: true; keypair: Keypair } | { ok: false; reason: string } | null {
  const b64 = (env.SOLANA_TREASURY_KEY_B64 ?? "").trim();
  if (!b64) return null;
  let raw: Buffer;
  try {
    raw = Buffer.from(b64, "base64");
  } catch {
    return { ok: false, reason: "SOLANA_TREASURY_KEY_B64 is not valid base64." };
  }
  if (raw.length < 32) {
    return {
      ok: false,
      reason: "SOLANA_TREASURY_KEY_B64 must decode to at least 32 bytes (64-byte secret or 32-byte seed).",
    };
  }

  const keypairs = tryKeypairsFromDecodedSecret(raw);
  for (const kp of keypairs) {
    if (kp.publicKey.equals(treasuryPk)) {
      return { ok: true, keypair: kp };
    }
  }

  const uniq = [...new Set(keypairs.map((k) => k.publicKey.toBase58()))];
  const derived = uniq.length ? uniq.join(", ") : "none (could not parse a Solana key from these bytes)";
  const want = treasuryPk.toBase58();
  const alt = uniq[0];
  const hint = alt
    ? ` Export the keypair for ${want}, or change SOLANA_TREASURY_ADDRESS to ${alt} if that is the wallet that should hold treasury tokens and pay fees.`
    : " Check that the value is base64 of a Solana JSON keypair (64 numbers) or 32-byte seed.";
  return {
    ok: false,
    reason: `Treasury key mismatch: derived pubkey(s) ${derived}; SOLANA_TREASURY_ADDRESS expects ${want}.${hint}`,
  };
}

/** @deprecated Use resolveTreasurySigningKeypair — name kept for call sites. */
export function resolveTreasurySigningKeypairFromMaster(
  env: NodeJS.ProcessEnv,
): { ok: true; keypair: Keypair } | { ok: false; reason: string } {
  return resolveTreasurySigningKeypair(env);
}

export function resolveTreasurySigningKeypair(
  env: NodeJS.ProcessEnv,
): { ok: true; keypair: Keypair } | { ok: false; reason: string } {
  const treasuryPk = treasuryPubkeyFromEnv(env);
  if (!treasuryPk) {
    return { ok: false, reason: "Set SOLANA_TREASURY_ADDRESS." };
  }

  const fromSecret = keypairFromTreasurySecretB64(env, treasuryPk);
  if (fromSecret) {
    return fromSecret;
  }

  const explicit = (env.SOLANA_TREASURY_DERIVATION_INDEX ?? "").trim();
  if (explicit) {
    const idx = Number.parseInt(explicit, 10);
    if (!Number.isFinite(idx) || idx < 0) {
      return { ok: false, reason: "SOLANA_TREASURY_DERIVATION_INDEX must be a non-negative integer." };
    }
    if (idx === RESERVED_SWEEP_FEE_PAYER_DERIVATION_INDEX) {
      return {
        ok: false,
        reason: "SOLANA_TREASURY_DERIVATION_INDEX cannot equal the reserved HD index.",
      };
    }
    try {
      const kp = deriveHdKeypairFromIndex(idx, env);
      if (!kp.publicKey.equals(treasuryPk)) {
        return {
          ok: false,
          reason: `Derived key at index ${idx} does not match SOLANA_TREASURY_ADDRESS (got ${kp.publicKey.toBase58()}).`,
        };
      }
      return { ok: true, keypair: kp };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, reason: msg };
    }
  }

  const maxScan = Math.min(
    2_000_000,
    Math.max(100, Number.parseInt(env.SOLANA_TREASURY_MAX_SCAN ?? "", 10) || DEFAULT_MAX_SCAN),
  );

  for (let i = 0; i < maxScan; i++) {
    if (i === RESERVED_SWEEP_FEE_PAYER_DERIVATION_INDEX) continue;
    try {
      const kp = deriveHdKeypairFromIndex(i, env);
      if (kp.publicKey.equals(treasuryPk)) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            `[treasury] Matched SOLANA_TREASURY_ADDRESS at HD index ${i} — set SOLANA_TREASURY_DERIVATION_INDEX=${i} to skip scanning.`,
          );
        }
        return { ok: true, keypair: kp };
      }
    } catch {
      /* master missing etc. — fail after loop */
    }
  }

  try {
    deriveHdKeypairFromIndex(0, env);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: msg };
  }

  return {
    ok: false,
    reason: `No HD index 0..${maxScan - 1} matches SOLANA_TREASURY_ADDRESS. Set SOLANA_TREASURY_DERIVATION_INDEX to the correct index, or set SOLANA_TREASURY_KEY_B64 to the base64-encoded secret for SOLANA_TREASURY_ADDRESS (when the treasury is not derived from SOLANA_CUSTODIAL_MASTER_KEY_B64).`,
  };
}
