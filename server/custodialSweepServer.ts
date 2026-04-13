/**
 * Server-side sweep of USDC (+ excess SOL) from a custodial deposit keypair to treasury.
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { MAINNET_USDC_MINT } from "./solanaUsdcScan";

const READ_COMMITMENT = "confirmed" as const;
const SOL_BUFFER_LAMPORTS = 1_000_000;

function treasuryPubkey(env: NodeJS.ProcessEnv): PublicKey | null {
  const s =
    env.VITE_SOLANA_TREASURY_ADDRESS?.trim() ||
    env.SOLANA_TREASURY_ADDRESS?.trim() ||
    "";
  if (!s) return null;
  try {
    return new PublicKey(s);
  } catch {
    return null;
  }
}

export type CustodialSweepResult =
  | { ok: true; signature: string; sweptUsdc: number; sweptSolLamports: number }
  | { ok: false; reason: string };

export async function sweepCustodialDepositToTreasury(
  connection: Connection,
  env: NodeJS.ProcessEnv,
  owner: Keypair,
): Promise<CustodialSweepResult> {
  const treasury = treasuryPubkey(env);
  if (!treasury) {
    return { ok: false, reason: "Set VITE_SOLANA_TREASURY_ADDRESS or SOLANA_TREASURY_ADDRESS for sweeps." };
  }

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
    return { ok: false, reason: "Nothing to sweep." };
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
    return { ok: false, reason: "No sweep instructions." };
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
