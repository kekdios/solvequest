/**
 * Mainnet USDC deposit parsing (shared logic with browser scanIncoming; server uses env RPC).
 */
import type { Connection, ParsedTransactionWithMeta } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

/** Mainnet USDC (legacy SPL). */
export const MAINNET_USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

export const READ_COMMITMENT = "confirmed" as const;

export function getUsdcAta(owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(MAINNET_USDC_MINT, owner, false);
}

export function usdcNetChangeForWallet(parsed: ParsedTransactionWithMeta, owner: PublicKey): number {
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

export type UsdcCredit = { signature: string; amountUsdc: number };

export type ScanLedger = {
  watermarkUsdcAta: string | null;
};

/**
 * Fetch signatures for USDC ATA, return new USDC credits since watermark (same semantics as browser).
 * First run: sets watermark to newest sig without crediting.
 */
export async function scanNewUsdcDeposits(
  connection: Connection,
  owner: PublicKey,
  ledger: ScanLedger,
): Promise<{ credits: UsdcCredit[]; ledger: ScanLedger }> {
  const ata = getUsdcAta(owner);
  const sigs = await connection.getSignaturesForAddress(ata, { limit: 40 }, READ_COMMITMENT);
  let next = ledger;

  if (sigs.length === 0) {
    return { credits: [], ledger: next };
  }

  if (next.watermarkUsdcAta === null) {
    next = { ...next, watermarkUsdcAta: sigs[0]!.signature };
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
    const tx = await connection.getParsedTransaction(signature, {
      commitment: READ_COMMITMENT,
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) continue;
    const amt = usdcNetChangeForWallet(tx as ParsedTransactionWithMeta, owner);
    if (amt <= 0) continue;
    credits.push({ signature, amountUsdc: amt });
  }

  next = { ...next, watermarkUsdcAta: sigs[0]!.signature };
  return { credits, ledger: next };
}
