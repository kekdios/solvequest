/**
 * Server-side sweep of USDC (+ excess SOL) from a custodial deposit keypair to treasury.
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SendTransactionError,
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
/** Native SOL required for fees; USDC in the ATA does not pay rent or signatures. */
const SWEEP_FEE_HEADROOM_LAMPORTS = 50_000;
/** ~rent-exempt minimum for a new SPL token account (treasury USDC ATA) if missing. */
const APPROX_SPL_TOKEN_ACCT_RENT_LAMPORTS = 2_100_000;

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

  let treasuryUsdcAtaMissing = false;
  if (usdcAmount > 0n) {
    try {
      await getAccount(connection, treasuryAta, READ_COMMITMENT);
    } catch {
      treasuryUsdcAtaMissing = true;
    }
    const minNative =
      SWEEP_FEE_HEADROOM_LAMPORTS + (treasuryUsdcAtaMissing ? APPROX_SPL_TOKEN_ACCT_RENT_LAMPORTS : 0);
    if (balLamports < minNative) {
      const addr = userPk.toBase58();
      return {
        ok: false,
        reason: treasuryUsdcAtaMissing
          ? `Custodial wallet needs native SOL for fees and to create the treasury USDC token account (≈${minNative} lamports); has ${balLamports}. Send ~0.003 SOL to ${addr} and retry.`
          : `Custodial wallet needs native SOL to pay transaction fees (${balLamports} lamports; min ~${minNative}). USDC in the deposit ATA cannot pay fees. Send ~0.001 SOL to ${addr} and retry.`,
      };
    }
  }

  const tx = new Transaction();

  if (usdcAmount > 0n) {
    try {
      await getOrCreateAssociatedTokenAccount(
        connection,
        owner,
        MAINNET_USDC_MINT,
        treasury,
        false,
        READ_COMMITMENT,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, reason: `Could not ensure treasury USDC token account: ${msg}` };
    }
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
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(raw, {
      skipPreflight: false,
      preflightCommitment: READ_COMMITMENT,
    });
  } catch (e: unknown) {
    if (e instanceof SendTransactionError) {
      let logSuffix = "";
      const cached = e.transactionError.logs;
      if (Array.isArray(cached) && cached.length > 0) {
        logSuffix = ` Logs: ${cached.join(" | ")}`;
      } else {
        try {
          const fetched = await e.getLogs(connection);
          if (Array.isArray(fetched) && fetched.length > 0) {
            logSuffix = ` Logs: ${fetched.join(" | ")}`;
          }
        } catch {
          /* getLogs needs a landed tx signature; simulation often has none */
        }
      }
      const msg = e.message;
      const debitHint =
        msg.includes("no record of a prior credit") || msg.includes("insufficient funds")
          ? " (Fund the custodial wallet with native SOL for fees; USDC balance does not pay network costs.)"
          : "";
      return { ok: false, reason: `${msg}${logSuffix}${debitHint}` };
    }
    throw e;
  }
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
