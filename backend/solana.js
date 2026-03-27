import crypto from "crypto"
import { LRUCache } from "lru-cache"
import { Keypair } from "@solana/web3.js"
import { derivePath } from "ed25519-hd-key"
import bip39 from "bip39"

/** Default path: first Solana account from BIP39 seed. */
const DERIVATION_PATH = "m/44'/501'/0'/0'"

const MAX_CACHE = Math.min(
  Math.max(Number(process.env.DERIVATION_CACHE_MAX) || 5000, 100),
  100_000
)

const derivationCache = new LRUCache({
  max: MAX_CACHE,
})

function mnemonicCacheKey(mnemonic) {
  const n = String(mnemonic ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
  return crypto.createHash("sha256").update(n).digest("hex")
}

export function mnemonicToAddress(mnemonic) {
  const seed = bip39.mnemonicToSeedSync(mnemonic)
  const derived = derivePath(DERIVATION_PATH, seed.toString("hex")).key
  return Keypair.fromSeed(derived).publicKey.toBase58()
}

/** Cached derivation keyed by SHA-256 of normalized mnemonic (no plaintext stored in cache). */
export function mnemonicToAddressCached(mnemonic) {
  const key = mnemonicCacheKey(mnemonic)
  let addr = derivationCache.get(key)
  if (addr) return addr
  addr = mnemonicToAddress(mnemonic)
  derivationCache.set(key, addr)
  return addr
}
