import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import bs58 from "bs58"
import { Keypair } from "@solana/web3.js"
import {
  parseQuestOperatorKeypair,
  isQuestAutoFundConfigured,
  transferQuestToPuzzleTarget,
} from "../quest-spl-fund.js"

const keys = [
  "QUEST_AUTO_FUND",
  "QUEST_OPERATOR_SECRET_KEY",
  "QUEST_OPERATOR_PUBLIC_KEY",
  "QUEST_MINT",
  "QUEST_FUND_AMOUNT_RAW",
]
const saved = {}

beforeEach(() => {
  for (const k of keys) saved[k] = process.env[k]
})
afterEach(() => {
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

test("parseQuestOperatorKeypair accepts JSON byte array", () => {
  const kp = Keypair.generate()
  const raw = JSON.stringify(Array.from(kp.secretKey))
  const out = parseQuestOperatorKeypair(raw)
  assert.equal(out.publicKey.toBase58(), kp.publicKey.toBase58())
})

test("parseQuestOperatorKeypair accepts base58", () => {
  const kp = Keypair.generate()
  const raw = bs58.encode(kp.secretKey)
  const out = parseQuestOperatorKeypair(raw)
  assert.equal(out.publicKey.toBase58(), kp.publicKey.toBase58())
})

test("isQuestAutoFundConfigured requires flag and vars", () => {
  delete process.env.QUEST_AUTO_FUND
  delete process.env.QUEST_OPERATOR_SECRET_KEY
  delete process.env.QUEST_MINT
  delete process.env.QUEST_FUND_AMOUNT_RAW
  assert.equal(isQuestAutoFundConfigured(), false)

  process.env.QUEST_AUTO_FUND = "1"
  process.env.QUEST_OPERATOR_SECRET_KEY = bs58.encode(Keypair.generate().secretKey)
  process.env.QUEST_MINT = "So11111111111111111111111111111111111111112"
  process.env.QUEST_FUND_AMOUNT_RAW = "1000"
  assert.equal(isQuestAutoFundConfigured(), true)
})

test("transferQuestToPuzzleTarget rejects pubkey mismatch", async () => {
  const kp = Keypair.generate()
  process.env.QUEST_OPERATOR_PUBLIC_KEY = Keypair.generate().publicKey.toBase58()
  await assert.rejects(
    () =>
      transferQuestToPuzzleTarget({
        rpcUrl: "https://api.mainnet-beta.solana.com",
        mintStr: "So11111111111111111111111111111111111111112",
        amountRawStr: "1",
        targetOwnerStr: Keypair.generate().publicKey.toBase58(),
        operatorKeypair: kp,
      }),
    /QUEST_OPERATOR_PUBLIC_KEY/
  )
})
