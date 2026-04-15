/**
 * Treasury must be an HD-derived pubkey from SOLANA_CUSTODIAL_MASTER_KEY_B64 (same scheme as custodial deposits).
 * Set SOLANA_TREASURY_DERIVATION_INDEX to skip scanning indices on startup.
 */
import { PublicKey, type Keypair } from "@solana/web3.js";
import {
  RESERVED_SWEEP_FEE_PAYER_DERIVATION_INDEX,
  deriveCustodialKeypairFromIndex,
} from "./custodialHdDerive";

const DEFAULT_MAX_SCAN = 50_000;

function treasuryPubkeyFromEnv(env: NodeJS.ProcessEnv): PublicKey | null {
  const s =
    (env.SOLANA_TREASURY_ADDRESS ?? env.VITE_SOLANA_TREASURY_ADDRESS ?? "").trim();
  if (!s) return null;
  try {
    return new PublicKey(s);
  } catch {
    return null;
  }
}

export function resolveTreasurySigningKeypairFromMaster(
  env: NodeJS.ProcessEnv,
): { ok: true; keypair: Keypair } | { ok: false; reason: string } {
  const treasuryPk = treasuryPubkeyFromEnv(env);
  if (!treasuryPk) {
    return { ok: false, reason: "Set SOLANA_TREASURY_ADDRESS." };
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
        reason: "SOLANA_TREASURY_DERIVATION_INDEX cannot equal the reserved sweep fee-payer index.",
      };
    }
    try {
      const kp = deriveCustodialKeypairFromIndex(idx, env);
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
      const kp = deriveCustodialKeypairFromIndex(i, env);
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
    deriveCustodialKeypairFromIndex(0, env);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: msg };
  }

  return {
    ok: false,
    reason: `No HD index 0..${maxScan - 1} matches SOLANA_TREASURY_ADDRESS. Set SOLANA_TREASURY_DERIVATION_INDEX.`,
  };
}
