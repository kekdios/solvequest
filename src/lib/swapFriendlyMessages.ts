/**
 * Maps swap API `error` codes to short, non-technical user copy.
 * See `plugins/swapApiPlugin.ts` POST /api/swap responses.
 */
export function friendlyQusdToUsdcSwapError(
  body: { error?: string; message?: string },
  httpStatus: number,
): string {
  const code = body.error ?? "";
  const msg = (body.message ?? "").trim();

  switch (code) {
    case "not_authenticated":
      return "Please sign in again to continue.";
    case "invalid_token":
    case "invalid_body":
      return "Your session may have expired. Please sign in again.";
    case "swap_not_configured":
      return "Swaps aren’t available right now. Please try again later.";
    case "db_missing":
    case "no_account":
      return "We couldn’t load your account. Please refresh the page or sign in again.";
    case "sol_not_verified":
      return "Verify your Solana wallet on the Account page before swapping.";
    case "missing_address":
      return "Add a verified Solana wallet on the Account page first.";
    case "invalid_address":
      return "Your saved wallet address needs to be updated on the Account page.";
    case "below_minimum":
      return msg.length > 0 && msg.length < 160
        ? msg
        : "That amount is below the minimum for a swap. Enter a larger amount.";
    case "below_effective_minimum":
      return msg.length > 0 && msg.length < 160
        ? msg
        : "After the reserved QUSD floor, nothing is left to convert. Enter a larger gross amount.";
    case "insufficient_qusd":
      return msg.length > 0 && msg.length < 160
        ? msg
        : "You don’t have enough QUSD for this swap. Try a smaller amount.";
    case "treasury_key":
    case "treasury_usdc_ata":
      return "Swaps are temporarily unavailable. Please try again later.";
    case "treasury_no_usdc":
      return "USDC payouts are paused while the service wallet is refilled. Please try again later.";
    case "treasury_low_sol":
      return "Network fees can’t be covered right now. Please try again later.";
    case "zero_after_caps":
      return "That amount is too small after limits, or we can’t cover it right now. Try a different amount.";
    case "preflight_failed":
      return "We couldn’t confirm this transfer on Solana. Check your wallet address or try again.";
    case "usdc_transfer_failed":
      return "We couldn’t finish sending USDC. Your QUSD was put back — please try again in a moment.";
    default:
      if (httpStatus === 502) {
        return "We couldn’t complete the USDC transfer. Your balance should be unchanged — please try again.";
      }
      if (httpStatus === 503) {
        return "Service is temporarily unavailable. Please try again in a moment.";
      }
      if (httpStatus === 401) return "Please sign in again to continue.";
      if (msg.length > 0 && msg.length < 200) return msg;
      return "Something went wrong. Please try again.";
  }
}
