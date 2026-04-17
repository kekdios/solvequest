/**
 * Scan the treasury (shared) USDC ATA for inbound transfers; resolve sender wallet from token meta.
 */
import type { Connection, ParsedTransactionWithMeta } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import {
  accountKeyAtParsed,
  getSignaturesForAtaPaginated,
  getUsdcAta,
  MAINNET_USDC_MINT,
  READ_COMMITMENT,
  usdcNetChangeForWallet,
} from "./solanaUsdcScan";

type TokenBalanceRow = NonNullable<
  NonNullable<ParsedTransactionWithMeta["meta"]>["preTokenBalances"]
>[number];

const SIG_PAGE_LIMIT = 40;

function usdcRawByAccountIndex(
  balances: readonly TokenBalanceRow[] | null | undefined,
): Map<number, bigint> {
  const m = new Map<number, bigint>();
  if (!balances?.length) return m;
  const mintStr = MAINNET_USDC_MINT.toBase58();
  for (const b of balances) {
    if (b.mint !== mintStr) continue;
    const a = b.uiTokenAmount?.amount;
    m.set(b.accountIndex, a != null && a !== "" ? BigInt(a) : 0n);
  }
  return m;
}

function usdcDeltasByAccountIndex(parsed: ParsedTransactionWithMeta): Map<number, bigint> {
  const meta = parsed.meta;
  if (!meta) return new Map();
  const pre = usdcRawByAccountIndex(meta.preTokenBalances);
  const post = usdcRawByAccountIndex(meta.postTokenBalances);
  const indices = new Set([...pre.keys(), ...post.keys()]);
  const out = new Map<number, bigint>();
  for (const i of indices) {
    const d = (post.get(i) ?? 0n) - (pre.get(i) ?? 0n);
    if (d !== 0n) out.set(i, d);
  }
  return out;
}

function ownerOfUsdcAccount(parsed: ParsedTransactionWithMeta, accountIndex: number): string | null {
  const mintStr = MAINNET_USDC_MINT.toBase58();
  const seen = new Set<string>();
  const balances = [...(parsed.meta?.preTokenBalances ?? []), ...(parsed.meta?.postTokenBalances ?? [])];
  for (const b of balances) {
    if (b.accountIndex !== accountIndex || b.mint !== mintStr || !b.owner) continue;
    if (seen.has(b.owner)) continue;
    seen.add(b.owner);
    return b.owner;
  }
  return null;
}

/**
 * Inbound USDC to the treasury wallet's USDC ATA, and the sender's **owner** wallet (linked user).
 * Returns null if no net inbound or sender cannot be determined unambiguously.
 */
export function parseInboundTreasuryUsdcWithSender(
  parsed: ParsedTransactionWithMeta,
  treasuryOwner: PublicKey,
): { amountUsdc: number; sender: PublicKey } | null {
  const amountUsdc = usdcNetChangeForWallet(parsed, treasuryOwner);
  if (amountUsdc <= 1e-9) return null;

  const treasuryAta = getUsdcAta(treasuryOwner);
  const treasuryStr = treasuryOwner.toBase58();
  const deltas = usdcDeltasByAccountIndex(parsed);

  let inRaw = 0n;
  for (const [idx, d] of deltas) {
    const key = accountKeyAtParsed(parsed, idx);
    if (key?.equals(treasuryAta) && d > 0n) inRaw += d;
  }
  if (inRaw <= 0n) return null;

  const outByOwner = new Map<string, bigint>();
  for (const [idx, d] of deltas) {
    if (d >= 0n) continue;
    const ownerStr = ownerOfUsdcAccount(parsed, idx);
    if (!ownerStr) continue;
    outByOwner.set(ownerStr, (outByOwner.get(ownerStr) ?? 0n) + -d);
  }

  /** One external sender wallet whose USDC ATA(s) net-outflow match the treasury inflow. */
  const candidates = new Map(outByOwner);
  if (candidates.has(treasuryStr)) {
    if (candidates.size === 1) return null;
    candidates.delete(treasuryStr);
  }
  if (candidates.size !== 1) return null;

  const [senderStr, rawOut] = [...candidates.entries()][0]!;
  const diff =
    inRaw > rawOut ? inRaw - rawOut : rawOut - inRaw;
  /** Allow 1 micro-USDC tolerance for rounding. */
  if (diff > 1n) return null;

  try {
    return { amountUsdc, sender: new PublicKey(senderStr) };
  } catch {
    return null;
  }
}

export type TreasuryInboundDeposit = {
  signature: string;
  amountUsdc: number;
  sender: PublicKey;
};

export type TreasuryScanLedger = {
  watermarkSignature: string | null;
};

/**
 * Lists new inbound treasury USDC transfers with resolved senders since the watermark.
 * Watermark advances past all newly seen signatures (even if parsing or DB credit fails).
 */
export async function scanTreasuryInboundDeposits(
  connection: Connection,
  treasuryOwner: PublicKey,
  ledger: TreasuryScanLedger,
): Promise<{ deposits: TreasuryInboundDeposit[]; ledger: TreasuryScanLedger }> {
  const ata = getUsdcAta(treasuryOwner);
  let next = ledger;

  if (next.watermarkSignature === null) {
    const allSigs = await getSignaturesForAtaPaginated(connection, ata);
    if (allSigs.length === 0) {
      return { deposits: [], ledger: next };
    }
    const chronological = [...allSigs].reverse();
    const deposits: TreasuryInboundDeposit[] = [];
    for (const { signature } of chronological) {
      const tx = await connection.getParsedTransaction(signature, {
        commitment: READ_COMMITMENT,
        maxSupportedTransactionVersion: 0,
      });
      if (!tx) continue;
      const parsed = tx as ParsedTransactionWithMeta;
      const row = parseInboundTreasuryUsdcWithSender(parsed, treasuryOwner);
      if (!row) continue;
      deposits.push({ signature, amountUsdc: row.amountUsdc, sender: row.sender });
    }
    next = { ...next, watermarkSignature: allSigs[0]!.signature };
    return { deposits, ledger: next };
  }

  const sigs = await connection.getSignaturesForAddress(ata, { limit: SIG_PAGE_LIMIT }, READ_COMMITMENT);
  if (sigs.length === 0) {
    return { deposits: [], ledger: next };
  }

  const newSigs: typeof sigs = [];
  for (const s of sigs) {
    if (s.signature === next.watermarkSignature) break;
    newSigs.push(s);
  }
  if (newSigs.length === 0) {
    return { deposits: [], ledger: next };
  }

  newSigs.reverse();

  const deposits: TreasuryInboundDeposit[] = [];
  for (const { signature } of newSigs) {
    const tx = await connection.getParsedTransaction(signature, {
      commitment: READ_COMMITMENT,
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) continue;
    const parsed = tx as ParsedTransactionWithMeta;
    const row = parseInboundTreasuryUsdcWithSender(parsed, treasuryOwner);
    if (!row) continue;
    deposits.push({ signature, amountUsdc: row.amountUsdc, sender: row.sender });
  }

  next = { ...next, watermarkSignature: sigs[0]!.signature };
  return { deposits, ledger: next };
}
