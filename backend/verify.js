import { PublicKey } from "@solana/web3.js"
import nacl from "tweetnacl"
import bs58 from "bs58"

/**
 * Verify a Solana (ed25519) detached signature over a UTF-8 message.
 * `pubkey` and `signature` are base58-encoded.
 */
export function verifySolanaSignature(pubkeyBase58, messageUtf8, signatureBase58) {
  try {
    const pk = new PublicKey(pubkeyBase58)
    const msg = new TextEncoder().encode(messageUtf8)
    const sig = bs58.decode(signatureBase58)
    if (sig.length !== 64) return false
    return nacl.sign.detached.verify(msg, sig, pk.toBytes())
  } catch {
    return false
  }
}
