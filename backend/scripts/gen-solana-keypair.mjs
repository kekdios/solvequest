#!/usr/bin/env node
/**
 * Generate a random Solana keypair for operator / funding wallets.
 *
 * Run from repo root:
 *   npm run gen-keypair --prefix backend
 * Or from backend/:
 *   npm run gen-keypair
 *
 * Never commit or paste the secret into chat. Store only in .env with tight permissions.
 */

import { Keypair } from "@solana/web3.js"
import bs58 from "bs58"

const kp = Keypair.generate()
const secretB58 = bs58.encode(kp.secretKey)
const secretJson = JSON.stringify(Array.from(kp.secretKey))

console.log("Public key (base58):")
console.log(kp.publicKey.toBase58())
console.log("")
console.log("Secret key (base58) — use as QUEST_OPERATOR_SECRET_KEY or similar:")
console.log(secretB58)
console.log("")
console.log("Secret key (JSON byte array) — alternative form for .env:")
console.log(secretJson)
console.log("")
console.log("Optional cross-check: QUEST_OPERATOR_PUBLIC_KEY should match the public line above.")
