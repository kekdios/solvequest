/**
 * Encrypts per-account custodial Solana secret keys at rest (testing: key material from env).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Keypair } from "@solana/web3.js";

function getDepositEncryptionKey(env: NodeJS.ProcessEnv): Buffer {
  const b64 = (env.VITE_SOLANA_TEST_SECRET_KEY_B64 || env.SOLANA_TEST_SECRET_KEY_B64 || "").trim();
  if (!b64) {
    throw new Error(
      "Set VITE_SOLANA_TEST_SECRET_KEY_B64 or SOLANA_TEST_SECRET_KEY_B64 for custodial deposit encryption (testing).",
    );
  }
  const raw = Buffer.from(b64, "base64");
  if (raw.length < 32) {
    throw new Error("Solana secret (base64) must decode to at least 32 bytes.");
  }
  return createHash("sha256").update(raw).digest();
}

export function encryptCustodialSecretKey(secretKey: Uint8Array, env: NodeJS.ProcessEnv): string {
  const key = getDepositEncryptionKey(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(secretKey)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
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
