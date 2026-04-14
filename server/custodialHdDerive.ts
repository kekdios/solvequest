/**
 * HD custodial deposit addresses: m/44'/501'/<index>'/0' from a master secret (env).
 * Master material (base64-encoded secret bytes): **SOLANA_CUSTODIAL_MASTER_KEY_B64** (server-only).
 */
import { createHash } from "node:crypto";
import { derivePath } from "ed25519-hd-key";
import { Keypair } from "@solana/web3.js";

/** 128-char hex string (64 bytes) used as SLIP-0010 seed input for ed25519-hd-key. */
export function hdMasterSeedHexFromEnv(env: NodeJS.ProcessEnv): string {
  const b64 = (env.SOLANA_CUSTODIAL_MASTER_KEY_B64 || "").trim();
  if (!b64) {
    throw new Error("Set SOLANA_CUSTODIAL_MASTER_KEY_B64 (server-only) for HD custodial derivation.");
  }
  const raw = Buffer.from(b64, "base64");
  if (raw.length < 32) {
    throw new Error("Solana master secret (base64) must decode to at least 32 bytes.");
  }
  return createHash("sha512").update(raw).digest("hex");
}

export function deriveCustodialKeypairFromIndex(derivationIndex: number, env: NodeJS.ProcessEnv): Keypair {
  if (!Number.isInteger(derivationIndex) || derivationIndex < 0) {
    throw new Error("custodial_derivation_index must be a non-negative integer");
  }
  const seedHex = hdMasterSeedHexFromEnv(env);
  const path = `m/44'/501'/${derivationIndex}'/0'`;
  const { key } = derivePath(path, seedHex);
  return Keypair.fromSeed(Uint8Array.from(key));
}
