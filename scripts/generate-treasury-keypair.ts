/**
 * Prints a new Solana keypair for Solve Quest treasury env vars.
 *
 *   npm run treasury:gen
 *
 * **Server (.env)** — base64 of the 64-byte secret (`SOLANA_TREASURY_KEY_B64`) matches
 * `server/treasurySigningKeypair.ts`. Wallets do **not** use this format.
 *
 * **Wallets (Phantom, Solflare, …)** — use the **Base58** line or save the **JSON array** as a file
 * and use “Import from keypair file” where supported. Paste Base58 into “Import private key” if the
 * wallet asks for it (same 64 bytes as Solana CLI `id.json`, different encoding than base64).
 */
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const kp = Keypair.generate();
const secret64 = Buffer.from(kp.secretKey);
const b64 = secret64.toString("base64");
const walletBase58 = bs58.encode(kp.secretKey);
const jsonKeypair = JSON.stringify(Array.from(kp.secretKey));

console.log("");
console.log("# --- Server .env (keep SOLANA_TREASURY_KEY_B64 secret) ---");
console.log("");
console.log(`SOLANA_TREASURY_ADDRESS=${kp.publicKey.toBase58()}`);
console.log(`SOLANA_TREASURY_KEY_B64=${b64}`);
console.log("");
console.log("# --- Wallet import (do NOT put Base58 in .env) ---");
console.log("# Paste the next line into Phantom / Solflare “Import private key” if it asks for Base58:");
console.log(walletBase58);
console.log("");
console.log("# Or save this single line as treasury.json and import as keypair file (64-byte array):");
console.log(jsonKeypair);
console.log("");
