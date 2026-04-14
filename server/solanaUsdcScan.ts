/**
 * Mainnet USDC deposit parsing (shared logic with browser scanIncoming; server uses env RPC).
 */
import type { Connection, ParsedTransactionWithMeta } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

type TokenBalanceRow = NonNullable<
  NonNullable<ParsedTransactionWithMeta["meta"]>["preTokenBalances"]
>[number];

function accountKeyAtParsed(parsed: ParsedTransactionWithMeta, index: number): PublicKey | undefined {
  const msg = parsed.transaction.message as {
    getAccountKeys?: () => { get: (i: number) => PublicKey | undefined };
    accountKeys?: Array<PublicKey | { pubkey: PublicKey }>;
  };
  if (typeof msg.getAccountKeys === "function") {
    return msg.getAccountKeys().get(index);
  }
  const raw = msg.accountKeys?.[index];
  if (raw == null) return undefined;
  return raw instanceof PublicKey ? raw : raw.pubkey;
}

/** Mainnet USDC (legacy SPL). */
export const MAINNET_USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

export const READ_COMMITMENT = "confirmed" as const;

export function getUsdcAta(owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(MAINNET_USDC_MINT, owner, false);
}

/**
 * USDC delta for this wallet's USDC ATA: prefer matching by token account pubkey (accountIndex),
 * fall back to meta.owner === wallet (some RPCs omit one of these).
 */
function usdcRawBalanceForWalletAta(
  balances: readonly TokenBalanceRow[] | null | undefined,
  parsed: ParsedTransactionWithMeta,
  mintStr: string,
  ata: PublicKey,
  walletOwnerStr: string,
): bigint {
  if (!balances?.length) return 0n;
  for (const b of balances) {
    if (b.mint !== mintStr) continue;
    const key = accountKeyAtParsed(parsed, b.accountIndex);
    if (key?.equals(ata)) {
      const a = b.uiTokenAmount?.amount;
      return a != null && a !== "" ? BigInt(a) : 0n;
    }
  }
  for (const b of balances) {
    if (b.mint !== mintStr) continue;
    if (b.owner === walletOwnerStr) {
      const a = b.uiTokenAmount?.amount;
      return a != null && a !== "" ? BigInt(a) : 0n;
    }
  }
  return 0n;
}

export function usdcNetChangeForWallet(parsed: ParsedTransactionWithMeta, owner: PublicKey): number {
  const meta = parsed.meta;
  if (!meta) return 0;
  const mintStr = MAINNET_USDC_MINT.toBase58();
  const ata = getUsdcAta(owner);
  const walletOwnerStr = owner.toBase58();
  const preRaw = usdcRawBalanceForWalletAta(meta.preTokenBalances, parsed, mintStr, ata, walletOwnerStr);
  const postRaw = usdcRawBalanceForWalletAta(meta.postTokenBalances, parsed, mintStr, ata, walletOwnerStr);
  const delta = postRaw - preRaw;
  if (delta <= 0n) return 0;
  return Number(delta) / 1e6;
}

/** On-chain USDC balance (human) at the wallet's canonical USDC ATA. */
export async function getUsdcAtaBalanceUi(connection: Connection, owner: PublicKey): Promise<number> {
  const ata = getUsdcAta(owner);
  try {
    const t = await connection.getTokenAccountBalance(ata, READ_COMMITMENT);
    return parseFloat(t.value.uiAmountString ?? "0");
  } catch {
    return 0;
  }
}

export type UsdcCredit = { signature: string; amountUsdc: number };

export type ScanLedger = {
  watermarkUsdcAta: string | null;
};

const SIG_PAGE_LIMIT = 40;
/** Cap RPC pagination so pathological ATAs do not loop forever (40k txs ≈ 1000 pages). */
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
 * Fetch signatures for USDC ATA, return new USDC credits since watermark (same semantics as browser).
 * First run (`watermarkUsdcAta === null`): paginates ATA history, credits each inbound USDC tx
 * oldest→newest, then sets the watermark to the newest signature (needed after DB reset / new account).
 */
export async function scanNewUsdcDeposits(
  connection: Connection,
  owner: PublicKey,
  ledger: ScanLedger,
): Promise<{ credits: UsdcCredit[]; ledger: ScanLedger }> {
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
      const tx = await connection.getParsedTransaction(signature, {
        commitment: READ_COMMITMENT,
        maxSupportedTransactionVersion: 0,
      });
      if (!tx) continue;
      const amt = usdcNetChangeForWallet(tx as ParsedTransactionWithMeta, owner);
      if (amt <= 0) continue;
      credits.push({ signature, amountUsdc: amt });
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
