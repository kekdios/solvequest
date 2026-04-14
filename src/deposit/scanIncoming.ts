import type { Connection, ParsedTransactionWithMeta } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { CustodyLedger } from "./depositLedger";
import { isSignatureCredited, markCredited } from "./depositLedger";
import { MAINNET_USDC_MINT, READ_COMMITMENT, makeConnection } from "./chainConfig";

export type UsdcCredit = { signature: string; amountUsdc: number };

export function getUsdcAta(owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(MAINNET_USDC_MINT, owner, false);
}

/**
 * Net USDC credited to the wallet owner's USDC token account(s) in this tx (6 decimals).
 * Uses meta pre/post token balances keyed by mint + owner (ATA owner = wallet).
 */
function usdcNetChangeForWallet(parsed: ParsedTransactionWithMeta, owner: PublicKey): number {
  const meta = parsed.meta;
  if (!meta) return 0;
  const mintStr = MAINNET_USDC_MINT.toBase58();
  const ownerStr = owner.toBase58();
  const pre = meta.preTokenBalances?.find((b) => b.mint === mintStr && b.owner === ownerStr);
  const post = meta.postTokenBalances?.find((b) => b.mint === mintStr && b.owner === ownerStr);
  const preRaw = pre?.uiTokenAmount?.amount != null ? BigInt(pre.uiTokenAmount.amount) : 0n;
  const postRaw = post?.uiTokenAmount?.amount != null ? BigInt(post.uiTokenAmount.amount) : 0n;
  const delta = postRaw - preRaw;
  if (delta <= 0n) return 0;
  return Number(delta) / 1e6;
}

const SIG_PAGE_LIMIT = 40;
const MAX_SIG_PAGES = 1000;

async function getSignaturesForAtaPaginated(
  connection: Connection,
  ata: PublicKey,
): Promise<Array<{ signature: string }>> {
  const all: Array<{ signature: string }> = [];
  let before: string | undefined;
  for (let page = 0; page < MAX_SIG_PAGES; page++) {
    const batch = await connection.getSignaturesForAddress(
      ata,
      { limit: SIG_PAGE_LIMIT, before },
      READ_COMMITMENT,
    );
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < SIG_PAGE_LIMIT) break;
    before = batch[batch.length - 1]!.signature;
  }
  return all;
}

/**
 * Fetch signatures newer than watermark, parse txs, return USDC credits not yet in ledger.
 * First run: paginates ATA history and credits inbound USDC (matches server after DB reset).
 */
export async function scanNewUsdcDeposits(
  connection: Connection,
  owner: PublicKey,
  ledger: CustodyLedger,
): Promise<{ credits: UsdcCredit[]; ledger: CustodyLedger }> {
  const ata = getUsdcAta(owner);
  let next = ledger;

  if (next.watermarkUsdcAta === null) {
    const allSigs = await getSignaturesForAtaPaginated(connection, ata);
    if (allSigs.length === 0) {
      return { credits: [], ledger: next };
    }
    const chronological = [...allSigs].reverse();
    const credits: UsdcCredit[] = [];
    for (const { signature } of chronological) {
      if (isSignatureCredited(next, signature)) continue;
      const tx = await connection.getParsedTransaction(signature, {
        commitment: READ_COMMITMENT,
        maxSupportedTransactionVersion: 0,
      });
      if (!tx) continue;
      const amt = usdcNetChangeForWallet(tx as ParsedTransactionWithMeta, owner);
      if (amt <= 0) continue;
      credits.push({ signature, amountUsdc: amt });
      next = markCredited(next, signature, { kind: "usdc", amountHuman: amt });
    }
    next = { ...next, watermarkUsdcAta: allSigs[0]!.signature };
    return { credits, ledger: next };
  }

  const sigs = await connection.getSignaturesForAddress(ata, { limit: SIG_PAGE_LIMIT }, READ_COMMITMENT);
  if (sigs.length === 0) {
    return { credits: [], ledger: next };
  }

  const newSigs: typeof sigs = [];
  for (const s of sigs) {
    if (s.signature === next.watermarkUsdcAta) break;
    newSigs.push(s);
  }
  if (newSigs.length === 0) {
    return { credits: [], ledger: next };
  }

  newSigs.reverse();

  const credits: UsdcCredit[] = [];
  for (const { signature } of newSigs) {
    if (isSignatureCredited(next, signature)) continue;
    const tx = await connection.getParsedTransaction(signature, {
      commitment: READ_COMMITMENT,
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) continue;
    const amt = usdcNetChangeForWallet(tx as ParsedTransactionWithMeta, owner);
    if (amt <= 0) continue;
    credits.push({ signature, amountUsdc: amt });
    next = markCredited(next, signature, { kind: "usdc", amountHuman: amt });
  }

  next = { ...next, watermarkUsdcAta: sigs[0]!.signature };
  return { credits, ledger: next };
}


/** One polling cycle: scan + merge ledger (caller saves). */
export async function runUsdcDepositScan(
  owner: PublicKey,
  ledger: CustodyLedger,
): Promise<{ credits: UsdcCredit[]; ledger: CustodyLedger }> {
  const connection = makeConnection();
  return scanNewUsdcDeposits(connection, owner, ledger);
}
