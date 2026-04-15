/**
 * User-facing copy for QUEST purchase (QUSD sell) API — keep technical codes in `error` for logs.
 */

/** Maps treasury preflight `reason` strings to readable messages. */
export function formatTreasuryPreflightMessage(reason: string): string {
  if (reason === "quest_amount_zero") {
    return "The QUEST amount for this purchase rounded to zero. Try a larger QUSD amount.";
  }
  if (reason === "quest_mint_missing") {
    return "The QUEST token mint could not be found on-chain. Check QUEST_MINT and your Solana RPC.";
  }
  if (reason === "treasury_quest_ata_missing") {
    return "Treasury QUEST account is not ready. Wait a few seconds and try again, or contact support if this persists.";
  }
  if (reason === "treasury_signer_mismatch") {
    return "Server configuration error: treasury signing key does not match SOLANA_TREASURY_ADDRESS.";
  }
  if (reason.startsWith("treasury_insufficient_quest:")) {
    const m = /need (\d+), have (\d+)/.exec(reason);
    if (m) {
      return `The treasury wallet does not hold enough QUEST for this purchase yet. An operator needs to send more QUEST to the treasury’s QUEST token account (on-chain need ${m[1]} smallest units, currently ${m[2]}).`;
    }
    return "The treasury wallet does not hold enough QUEST for this purchase. Contact support or try a smaller amount.";
  }
  if (reason.startsWith("treasury_insufficient_sol:")) {
    return "Treasury wallet needs more SOL to pay transaction fees (and possibly to create your QUEST receive account). Fund SOLANA_TREASURY_ADDRESS with SOL.";
  }
  return `Purchase could not be validated: ${reason}`;
}

/** Shortens on-chain send errors for end users (full reason still in logs server-side). */
export function formatQuestTransferFailureMessage(reason: string): string {
  const lower = reason.toLowerCase();
  if (lower.includes("insufficient") && lower.includes("lamport")) {
    return "Transaction failed: treasury may be short on SOL for fees. Fund the treasury wallet with SOL and try again.";
  }
  if (lower.includes("insufficient funds") || lower.includes("custom program error")) {
    return "Transaction failed on Solana (token or account issue). Try again or contact support if it continues.";
  }
  if (lower.includes("blockhash") || lower.includes("expired")) {
    return "Network was busy and the transaction expired. Please try again.";
  }
  const first = reason.split("\n")[0]?.trim() ?? reason;
  if (first.length > 220) {
    return `${first.slice(0, 217)}…`;
  }
  return first;
}
