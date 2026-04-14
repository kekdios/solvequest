/**
 * Decrypts legacy per-account custodial rows (`custodial_seckey_enc`); HD accounts derive keys from env + index.
 */
import { createDecipheriv, createHash } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { deriveCustodialKeypairFromIndex } from "./custodialHdDerive";

/** Legacy `custodial_seckey_enc` rows were keyed from the same base64 material; use `SOLANA_CUSTODIAL_MASTER_KEY_B64` (same bytes as before if migrating from test env names). */
function getDepositEncryptionKey(env: NodeJS.ProcessEnv): Buffer {
  const b64 = (env.SOLANA_CUSTODIAL_MASTER_KEY_B64 || "").trim();
  if (!b64) {
    throw new Error("Set SOLANA_CUSTODIAL_MASTER_KEY_B64 for custodial deposit encryption (legacy rows).");
  }
  const raw = Buffer.from(b64, "base64");
  if (raw.length < 32) {
    throw new Error("Solana secret (base64) must decode to at least 32 bytes.");
  }
  return createHash("sha256").update(raw).digest();
}

export function decryptCustodialKeypair(enc: string, env: NodeJS.ProcessEnv): Keypair {
  const key = getDepositEncryptionKey(env);
  const parts = enc.split(":");
  if (parts.length !== 3) throw new Error("invalid custodial_seckey_enc");
  const iv = Buffer.from(parts[0]!, "hex");
  const tag = Buffer.from(parts[1]!, "hex");
  const data = Buffer.from(parts[2]!, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return Keypair.fromSecretKey(Uint8Array.from(dec));
}

/** Resolves signing key for custodial deposit: legacy encrypted row, or HD derivation from index. */
export function resolveCustodialDepositKeypair(
  row: { custodial_seckey_enc: string | null; custodial_derivation_index: number | null },
  env: NodeJS.ProcessEnv,
): Keypair | null {
  if (row.custodial_seckey_enc) {
    return decryptCustodialKeypair(row.custodial_seckey_enc, env);
  }
  const idx = row.custodial_derivation_index;
  if (idx != null && Number.isInteger(Number(idx))) {
    return deriveCustodialKeypairFromIndex(Number(idx), env);
  }
  return null;
}
