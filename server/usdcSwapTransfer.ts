/**
 * Send USDC (SPL) from treasury to a user wallet — used by QUSD→USDC swap.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SendTransactionError,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ACCOUNT_SIZE,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import { MAINNET_USDC_MINT } from "./solanaUsdcScan";

const READ_COMMITMENT = "confirmed" as const;
const SOL_HEADROOM_LAMPORTS = 100_000;

/** Ensures treasury has a USDC token account (creates ATA if missing). */
export async function ensureTreasuryUsdcAta(
  connection: Connection,
  treasuryKeypair: Keypair,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const usdcMint = MAINNET_USDC_MINT;
  const mintInfo = await connection.getAccountInfo(usdcMint, READ_COMMITMENT);
  if (!mintInfo) {
    return { ok: false, reason: "usdc_mint_missing" };
  }
  const tokenProgram = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
  const treasury = treasuryKeypair.publicKey;
  const treasuryAta = getAssociatedTokenAddressSync(usdcMint, treasury, false, tokenProgram);
  try {
    await getAccount(connection, treasuryAta, READ_COMMITMENT, tokenProgram);
    return { ok: true };
  } catch {
    /* create ATA */
  }

  const ix = createAssociatedTokenAccountInstruction(
    treasuryKeypair.publicKey,
    treasuryAta,
    treasury,
    usdcMint,
    tokenProgram,
  );
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(READ_COMMITMENT);
  const tx = new Transaction({
    feePayer: treasuryKeypair.publicKey,
    recentBlockhash: blockhash,
  }).add(ix);

  try {
    tx.sign(treasuryKeypair);
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: READ_COMMITMENT,
      maxRetries: 3,
    });
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      READ_COMMITMENT,
    );
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: `Could not create treasury USDC token account (needs SOL for rent + fees). ${msg}`,
    };
  }
}

export type UsdcSwapPreflightOk = {
  treasuryUsdcRaw: bigint;
  treasurySolLamports: number;
  decimals: number;
  tokenProgram: PublicKey;
  treasuryAta: PublicKey;
  userAta: PublicKey;
  userNeedsAta: boolean;
  minSolRequired: number;
};

export async function preflightTreasuryUsdcSend(
  connection: Connection,
  treasury: PublicKey,
  treasurySigner: Keypair,
  userOwner: PublicKey,
  amountRaw: bigint,
): Promise<{ ok: true; details: UsdcSwapPreflightOk } | { ok: false; reason: string }> {
  if (amountRaw <= 0n) {
    return { ok: false, reason: "usdc_amount_zero" };
  }

  const usdcMint = MAINNET_USDC_MINT;
  const mintInfo = await connection.getAccountInfo(usdcMint, READ_COMMITMENT);
  if (!mintInfo) {
    return { ok: false, reason: "usdc_mint_missing" };
  }
  const tokenProgram = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;

  const mint = await getMint(connection, usdcMint, READ_COMMITMENT, tokenProgram);
  const decimals = mint.decimals;

  const treasuryAta = getAssociatedTokenAddressSync(usdcMint, treasury, false, tokenProgram);
  const userAta = getAssociatedTokenAddressSync(usdcMint, userOwner, false, tokenProgram);

  let treasuryUsdcRaw = 0n;
  try {
    const t = await getAccount(connection, treasuryAta, READ_COMMITMENT, tokenProgram);
    treasuryUsdcRaw = t.amount;
  } catch {
    return { ok: false, reason: "treasury_usdc_ata_missing" };
  }

  if (treasuryUsdcRaw < amountRaw) {
    return {
      ok: false,
      reason: `treasury_insufficient_usdc: need ${amountRaw}, have ${treasuryUsdcRaw}`,
    };
  }

  let userNeedsAta = false;
  try {
    await getAccount(connection, userAta, READ_COMMITMENT, tokenProgram);
  } catch {
    userNeedsAta = true;
  }

  const rentLamports = await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);
  const sigFee = 5_000;
  const minSolRequired = (userNeedsAta ? rentLamports : 0) + sigFee + SOL_HEADROOM_LAMPORTS;

  const treasurySolLamports = await connection.getBalance(treasury, READ_COMMITMENT);
  if (treasurySolLamports < minSolRequired) {
    return {
      ok: false,
      reason: `treasury_insufficient_sol: need ≥${minSolRequired} lamports (fees${userNeedsAta ? " + user USDC ATA rent" : ""}), have ${treasurySolLamports}`,
    };
  }

  if (!treasurySigner.publicKey.equals(treasury)) {
    return { ok: false, reason: "treasury_signer_mismatch" };
  }

  return {
    ok: true,
    details: {
      treasuryUsdcRaw,
      treasurySolLamports,
      decimals,
      tokenProgram,
      treasuryAta,
      userAta,
      userNeedsAta,
      minSolRequired,
    },
  };
}

export async function sendUsdcFromTreasuryToUser(
  connection: Connection,
  treasuryKeypair: Keypair,
  userOwner: PublicKey,
  amountRaw: bigint,
  preflight: UsdcSwapPreflightOk,
): Promise<{ ok: true; signature: string } | { ok: false; reason: string }> {
  const usdcMint = MAINNET_USDC_MINT;
  const { decimals, tokenProgram, treasuryAta, userAta, userNeedsAta } = preflight;

  const ix = [];
  if (userNeedsAta) {
    ix.push(
      createAssociatedTokenAccountInstruction(
        treasuryKeypair.publicKey,
        userAta,
        userOwner,
        usdcMint,
        tokenProgram,
      ),
    );
  }
  ix.push(
    createTransferCheckedInstruction(
      treasuryAta,
      usdcMint,
      userAta,
      treasuryKeypair.publicKey,
      amountRaw,
      decimals,
      [],
      tokenProgram,
    ),
  );

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(READ_COMMITMENT);
  const tx = new Transaction({
    feePayer: treasuryKeypair.publicKey,
    recentBlockhash: blockhash,
  });
  for (const i of ix) tx.add(i);

  try {
    tx.sign(treasuryKeypair);
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: READ_COMMITMENT,
      maxRetries: 3,
    });
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      READ_COMMITMENT,
    );
    return { ok: true, signature };
  } catch (e) {
    if (e instanceof SendTransactionError) {
      const logs = await e.getLogs(connection).catch(() => undefined);
      const tail = logs?.length ? logs.slice(-5).join("\n") : "";
      return {
        ok: false,
        reason: `send_failed: ${e.message}${tail ? `\n${tail}` : ""}`,
      };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `send_failed: ${msg}` };
  }
}
