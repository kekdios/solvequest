import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import {
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { MAINNET_USDC_MINT, READ_COMMITMENT, makeConnection, treasuryPubkey } from "./chainConfig";

/** Keep this many lamports for fees + rent after sweeping SOL. */
const SOL_BUFFER_LAMPORTS = 1_000_000;

export type SweepResult =
  | { ok: true; signature: string; sweptUsdc: number; sweptSolLamports: number }
  | { ok: false; reason: string };

/**
 * Moves USDC (full balance) from the user ATA to the treasury USDC ATA, and optionally excess SOL
 * (above buffer) to the treasury SOL address. Requires `VITE_SOLANA_TREASURY_ADDRESS`.
 */
export async function sweepCustodialToTreasury(owner: Keypair): Promise<SweepResult> {
  const treasury = treasuryPubkey();
  if (!treasury) {
    return { ok: false, reason: "Set VITE_SOLANA_TREASURY_ADDRESS to enable sweeps." };
  }

  const connection = makeConnection();
  const userPk = owner.publicKey;
  const userAta = getAssociatedTokenAddressSync(MAINNET_USDC_MINT, userPk, false);
  const treasuryAta = getAssociatedTokenAddressSync(MAINNET_USDC_MINT, treasury, false);

  let usdcAmount = 0n;
  try {
    const acc = await getAccount(connection, userAta, READ_COMMITMENT);
    usdcAmount = acc.amount;
  } catch {
    usdcAmount = 0n;
  }

  const balLamports = await connection.getBalance(userPk, READ_COMMITMENT);
  const solToSend = Math.max(0, balLamports - SOL_BUFFER_LAMPORTS);

  if (usdcAmount === 0n && solToSend < 5000) {
    return { ok: false, reason: "Nothing to sweep (USDC empty, SOL below buffer)." };
  }

  const tx = new Transaction();

  if (usdcAmount > 0n) {
    await getOrCreateAssociatedTokenAccount(
      connection,
      owner,
      MAINNET_USDC_MINT,
      treasury,
      false,
      READ_COMMITMENT,
    );
    tx.add(createTransferInstruction(userAta, treasuryAta, userPk, usdcAmount));
  }

  if (solToSend > 5000) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: userPk,
        toPubkey: treasury,
        lamports: solToSend,
      }),
    );
  }

  if (tx.instructions.length === 0) {
    return { ok: false, reason: "No sweep instructions after thresholds." };
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(READ_COMMITMENT);
  tx.recentBlockhash = blockhash;
  tx.feePayer = userPk;
  tx.sign(owner);

  const raw = tx.serialize();
  const signature = await connection.sendRawTransaction(raw, {
    skipPreflight: false,
    preflightCommitment: READ_COMMITMENT,
  });
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, READ_COMMITMENT);

  return {
    ok: true,
    signature,
    sweptUsdc: Number(usdcAmount) / 1e6,
    sweptSolLamports: solToSend,
  };
}

export function formatLamportsSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(6);
}
