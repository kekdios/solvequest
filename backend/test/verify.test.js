import { test } from "node:test"
import assert from "node:assert/strict"
import { Keypair } from "@solana/web3.js"
import nacl from "tweetnacl"
import bs58 from "bs58"
import { verifySolanaSignature } from "../verify.js"

test("verifySolanaSignature accepts valid detached signature", () => {
  const kp = Keypair.generate()
  const message = "solve:001:1700000000:abc"
  const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey)
  assert.equal(
    verifySolanaSignature(kp.publicKey.toBase58(), message, bs58.encode(sig)),
    true
  )
})

test("verifySolanaSignature rejects tampered message", () => {
  const kp = Keypair.generate()
  const sig = nacl.sign.detached(
    new TextEncoder().encode("original"),
    kp.secretKey
  )
  assert.equal(
    verifySolanaSignature(kp.publicKey.toBase58(), "tampered", bs58.encode(sig)),
    false
  )
})
