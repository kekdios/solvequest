/**
 * Send QUEST (SPL) from treasury to a user wallet; treasury keypair matches HD derivation (see treasurySigningKeypair).
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

const READ_COMMITMENT = "confirmed" as const;
/** Native SOL buffer beyond rent + signature fee so preflight is conservative. */
const SOL_HEADROOM_LAMPORTS = 100_000;

export type PrizePreflightOk = {
  treasuryQuestRaw: bigint;
  treasurySolLamports: number;
  decimals: number;
  tokenProgram: PublicKey;
  treasuryAta: PublicKey;
  userAta: PublicKey;
  userNeedsAta: boolean;
  minSolRequired: number;
};

export async function preflightTreasuryQuestSend(
  connection: Connection,
  treasury: PublicKey,
  treasurySigner: Keypair,
  questMint: PublicKey,
  userOwner: PublicKey,
  amountRaw: bigint,
): Promise<
  | { ok: true; details: PrizePreflightOk }
  | { ok: false; reason: string }
> {
  if (amountRaw <= 0n) {
    return { ok: false, reason: "quest_amount_zero" };
  }

  const mintInfo = await connection.getAccountInfo(questMint, READ_COMMITMENT);
  if (!mintInfo) {
    return { ok: false, reason: "quest_mint_missing" };
  }
  const tokenProgram = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;

  const mint = await getMint(connection, questMint, READ_COMMITMENT, tokenProgram);
  const decimals = mint.decimals;

  const treasuryAta = getAssociatedTokenAddressSync(questMint, treasury, false, tokenProgram);
  const userAta = getAssociatedTokenAddressSync(questMint, userOwner, false, tokenProgram);

  let treasuryQuestRaw = 0n;
  try {
    const t = await getAccount(connection, treasuryAta, READ_COMMITMENT, tokenProgram);
    treasuryQuestRaw = t.amount;
  } catch {
    return { ok: false, reason: "treasury_quest_ata_missing" };
  }

  if (treasuryQuestRaw < amountRaw) {
    return {
      ok: false,
      reason: `treasury_insufficient_quest: need ${amountRaw}, have ${treasuryQuestRaw}`,
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
  const minSolRequired =
    (userNeedsAta ? rentLamports : 0) + sigFee + SOL_HEADROOM_LAMPORTS;

  const treasurySolLamports = await connection.getBalance(treasury, READ_COMMITMENT);
  if (treasurySolLamports < minSolRequired) {
    return {
      ok: false,
      reason: `treasury_insufficient_sol: need ≥${minSolRequired} lamports (incl. fees${userNeedsAta ? " + user QUEST ATA rent" : ""}), have ${treasurySolLamports}`,
    };
  }

  if (!treasurySigner.publicKey.equals(treasury)) {
    return { ok: false, reason: "treasury_signer_mismatch" };
  }

  return {
    ok: true,
    details: {
      treasuryQuestRaw,
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

export async function sendQuestFromTreasuryToUser(
  connection: Connection,
  treasuryKeypair: Keypair,
  questMint: PublicKey,
  userOwner: PublicKey,
  amountRaw: bigint,
  preflight: PrizePreflightOk,
): Promise<{ ok: true; signature: string } | { ok: false; reason: string }> {
  const { decimals, tokenProgram, treasuryAta, userAta, userNeedsAta } = preflight;

  const ix = [];
  if (userNeedsAta) {
    ix.push(
      createAssociatedTokenAccountInstruction(
        treasuryKeypair.publicKey,
        userAta,
        userOwner,
        questMint,
        tokenProgram,
      ),
    );
  }
  ix.push(
    createTransferCheckedInstruction(
      treasuryAta,
      questMint,
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
    const raw = tx.serialize();
    const signature = await connection.sendRawTransaction(raw, {
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
