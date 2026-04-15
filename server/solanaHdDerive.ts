/**
 * SLIP-0010 style HD derivation: m/44'/501'/<index>'/0' from **SOLANA_CUSTODIAL_MASTER_KEY_B64** (server-only).
 * Used to resolve **SOLANA_TREASURY_ADDRESS** when **SOLANA_TREASURY_KEY_B64** is not set (optional HD match / scan).
 */
import { createHash } from "node:crypto";
import { derivePath } from "ed25519-hd-key";
import { Keypair } from "@solana/web3.js";

/** 128-char hex string (64 bytes) used as SLIP-0010 seed input for ed25519-hd-key. */
export function hdMasterSeedHexFromEnv(env: NodeJS.ProcessEnv): string {
  const b64 = (env.SOLANA_CUSTODIAL_MASTER_KEY_B64 || "").trim();
  if (!b64) {
    throw new Error(
      "Set SOLANA_CUSTODIAL_MASTER_KEY_B64 (server-only) when using HD treasury resolution.",
    );
  }
  const raw = Buffer.from(b64, "base64");
  if (raw.length < 32) {
    throw new Error("Solana master secret (base64) must decode to at least 32 bytes.");
  }
  return createHash("sha512").update(raw).digest("hex");
}

export function deriveHdKeypairFromIndex(derivationIndex: number, env: NodeJS.ProcessEnv): Keypair {
  if (!Number.isInteger(derivationIndex) || derivationIndex < 0) {
    throw new Error("derivation index must be a non-negative integer");
  }
  const seedHex = hdMasterSeedHexFromEnv(env);
  const path = `m/44'/501'/${derivationIndex}'/0'`;
  const { key } = derivePath(path, seedHex);
  return Keypair.fromSeed(Uint8Array.from(key));
}

/** Skip this index when scanning for treasury HD match (legacy reserved slot). */
export const RESERVED_SWEEP_FEE_PAYER_DERIVATION_INDEX = 1_000_000_000;
