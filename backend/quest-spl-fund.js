/**
 * Optional QUEST SPL transfer: operator wallet → puzzle TARGET_ADDRESS (recipient ATA).
 * Used after vault bootstrap when QUEST_AUTO_FUND=1 and QUEST_* env is complete.
 */

import bs58 from "bs58"
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js"
import { createTransferInstruction, getOrCreateAssociatedTokenAccount } from "@solana/spl-token"

/**
 * @param {string} secretRaw - base58 secret or JSON byte array (Solana CLI format)
 * @returns {import("@solana/web3.js").Keypair}
 */
export function parseQuestOperatorKeypair(secretRaw) {
  const raw = String(secretRaw ?? "").trim()
  if (!raw) throw new Error("QUEST_OPERATOR_SECRET_KEY is empty")
  if (raw.startsWith("[")) {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) {
      throw new Error("QUEST_OPERATOR_SECRET_KEY JSON must be a numeric byte array")
    }
    return Keypair.fromSecretKey(Uint8Array.from(arr))
  }
  return Keypair.fromSecretKey(bs58.decode(raw))
}

function questAutoFundEnabled() {
  const v = process.env.QUEST_AUTO_FUND?.trim().toLowerCase()
  return v === "1" || v === "true" || v === "yes" || v === "on"
}

/** True when an on-chain QUEST send should run after bootstrap. */
export function isQuestAutoFundConfigured() {
  if (!questAutoFundEnabled()) return false
  const k = process.env.QUEST_OPERATOR_SECRET_KEY?.trim()
  const m = process.env.QUEST_MINT?.trim()
  const a = process.env.QUEST_FUND_AMOUNT_RAW?.trim()
  if (!k || !m || !a || !/^\d+$/.test(a) || a === "0") return false
  return true
}

/**
 * Transfer QUEST (raw amount) from operator ATA to puzzle target's ATA.
 * Creates recipient ATA if missing (operator pays rent).
 *
 * @param {object} p
 * @param {string} p.rpcUrl
 * @param {string} p.mintStr - QUEST mint base58
 * @param {string} p.amountRawStr - smallest units, decimal string
 * @param {string} p.targetOwnerStr - TARGET_ADDRESS (owner of derived prize wallet)
 * @param {import("@solana/web3.js").Keypair} p.operatorKeypair
 * @returns {Promise<string>} transaction signature
 */
export async function transferQuestToPuzzleTarget({
  rpcUrl,
  mintStr,
  amountRawStr,
  targetOwnerStr,
  operatorKeypair,
}) {
  const mint = new PublicKey(mintStr)
  const destOwner = new PublicKey(targetOwnerStr)
  const amount = BigInt(amountRawStr)
  const conn = new Connection(rpcUrl, "confirmed")

  const opPub = process.env.QUEST_OPERATOR_PUBLIC_KEY?.trim()
  if (opPub && opPub !== operatorKeypair.publicKey.toBase58()) {
    throw new Error(
      "QUEST_OPERATOR_PUBLIC_KEY does not match pubkey derived from QUEST_OPERATOR_SECRET_KEY"
    )
  }

  const sourceAta = await getOrCreateAssociatedTokenAccount(
    conn,
    operatorKeypair,
    mint,
    operatorKeypair.publicKey
  )
  const destAta = await getOrCreateAssociatedTokenAccount(
    conn,
    operatorKeypair,
    mint,
    destOwner
  )

  const ix = createTransferInstruction(
    sourceAta.address,
    destAta.address,
    operatorKeypair.publicKey,
    amount
  )
  const tx = new Transaction().add(ix)
  const sig = await sendAndConfirmTransaction(conn, tx, [operatorKeypair], {
    commitment: "confirmed",
  })
  return sig
}

/**
 * After bootstrap insert: if configured, send QUEST and set puzzles.quest_fund_tx.
 * @param {import("better-sqlite3").Database} db
 * @param {number} puzzleRowId
 * @returns {Promise<string|null>} signature or null if skipped
 */
export async function tryQuestFundAfterBootstrap(db, puzzleRowId) {
  if (!isQuestAutoFundConfigured()) {
    if (questAutoFundEnabled()) {
      console.warn(
        "[quest-fund] QUEST_AUTO_FUND is on but QUEST_OPERATOR_SECRET_KEY, QUEST_MINT, or QUEST_FUND_AMOUNT_RAW is missing/invalid — skipping transfer"
      )
    } else {
      console.log(
        "[quest-fund] skipped (set QUEST_AUTO_FUND=1 with QUEST_OPERATOR_SECRET_KEY, QUEST_MINT, QUEST_FUND_AMOUNT_RAW to send QUEST at bootstrap)"
      )
    }
    return null
  }

  const row = db
    .prepare(`SELECT id, target_address, quest_fund_tx FROM puzzles WHERE id = ?`)
    .get(puzzleRowId)
  if (!row) throw new Error(`puzzle row ${puzzleRowId} not found`)
  if (row.quest_fund_tx) {
    console.log("[quest-fund] skipped: row already has quest_fund_tx", row.quest_fund_tx)
    return row.quest_fund_tx
  }

  const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com"
  const kp = parseQuestOperatorKeypair(process.env.QUEST_OPERATOR_SECRET_KEY)
  const sig = await transferQuestToPuzzleTarget({
    rpcUrl,
    mintStr: process.env.QUEST_MINT.trim(),
    amountRawStr: process.env.QUEST_FUND_AMOUNT_RAW.trim(),
    targetOwnerStr: row.target_address,
    operatorKeypair: kp,
  })
  db.prepare(`UPDATE puzzles SET quest_fund_tx = ? WHERE id = ?`).run(sig, puzzleRowId)
  return sig
}
