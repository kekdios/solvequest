/**
 * Convert existing SOLANA_TREASURY_KEY_B64 (server format) to wallet-friendly Base58 + JSON array.
 *
 *   npx tsx scripts/treasury-b64-to-wallet.ts "$SOLANA_TREASURY_KEY_B64"
 *
 * Or paste the base64 string as the only argument (no newline).
 */
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const b64 = (process.argv[2] ?? "").trim();
if (!b64) {
  console.error("Usage: npx tsx scripts/treasury-b64-to-wallet.ts <SOLANA_TREASURY_KEY_B64>");
  process.exit(1);
}

let raw: Buffer;
try {
  raw = Buffer.from(b64, "base64");
} catch {
  console.error("Invalid base64.");
  process.exit(1);
}

function tryKp(): Keypair | null {
  if (raw.length >= 64) {
    try {
      return Keypair.fromSecretKey(Uint8Array.from(raw.subarray(0, 64)));
    } catch {
      /* */
    }
  }
  if (raw.length >= 32) {
    try {
      return Keypair.fromSeed(Uint8Array.from(raw.subarray(0, 32)));
    } catch {
      /* */
    }
  }
  return null;
}

const kp = tryKp();
if (!kp) {
  console.error("Could not parse a Solana keypair from decoded bytes (need 32-byte seed or 64-byte secret).");
  process.exit(1);
}

const walletBase58 = bs58.encode(kp.secretKey);
const jsonKeypair = JSON.stringify(Array.from(kp.secretKey));

console.log("");
console.log(`SOLANA_TREASURY_ADDRESS=${kp.publicKey.toBase58()}`);
console.log("");
console.log("# Wallet — paste Base58 into “Import private key”:");
console.log(walletBase58);
console.log("");
console.log("# Or keypair JSON file (one line):");
console.log(jsonKeypair);
console.log("");
