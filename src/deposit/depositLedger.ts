/**
 * Idempotent deposit ledger + scan watermarks (browser localStorage).
 * Server-side: mirror in `deposit_credits` SQLite table (see db/migrations).
 */
const LEDGER_PREFIX = "insured-deposit-ledger-v1";

export type CustodyLedger = {
  /** Processed tx signatures — never credit twice. */
  creditedSignatures: Record<string, { at: number; kind: "usdc" | "sol"; amountHuman?: number; lamports?: number }>;
  /** Newest signature seen on first run — we do not back-credit history before this. */
  watermarkUsdcAta: string | null;
};

const empty = (): CustodyLedger => ({
  creditedSignatures: {},
  watermarkUsdcAta: null,
});

function key(accountId: string): string {
  return `${LEDGER_PREFIX}:${accountId}`;
}

export function loadLedger(accountId: string): CustodyLedger {
  if (typeof window === "undefined" || !window.localStorage) return empty();
  try {
    const raw = window.localStorage.getItem(key(accountId));
    if (!raw) return empty();
    const p = JSON.parse(raw) as CustodyLedger;
    return {
      creditedSignatures: typeof p.creditedSignatures === "object" && p.creditedSignatures ? p.creditedSignatures : {},
      watermarkUsdcAta: typeof p.watermarkUsdcAta === "string" || p.watermarkUsdcAta === null ? p.watermarkUsdcAta : null,
    };
  } catch {
    return empty();
  }
}

export function saveLedger(accountId: string, ledger: CustodyLedger): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.setItem(key(accountId), JSON.stringify(ledger));
}

export function clearDepositLedger(accountId: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.removeItem(key(accountId));
}

export function isSignatureCredited(ledger: CustodyLedger, signature: string): boolean {
  return Boolean(ledger.creditedSignatures[signature]);
}

export function markCredited(
  ledger: CustodyLedger,
  signature: string,
  meta: { kind: "usdc" | "sol"; amountHuman?: number; lamports?: number },
): CustodyLedger {
  return {
    ...ledger,
    creditedSignatures: {
      ...ledger.creditedSignatures,
      [signature]: { at: Date.now(), ...meta },
    },
  };
}
