/**
 * Maps SQLite `accounts` row ↔ engine concepts.
 * Not persisted (derive at runtime): equity, unrealizedPnL, marks, coverage warning flags.
 */
export type PersistedAccountRow = {
  id: string;
  created_at: number;
  updated_at: number;
  /** Set when row is tied to email login — matches JWT `email` */
  email: string | null;
  usdc_balance: number;
  coverage_limit_qusd: number;
  premium_accrued_usdc: number;
  covered_losses_qusd: number;
  coverage_used_qusd: number;
  tier_id: 1 | 2 | 3;
  qusd_unlocked: number;
  qusd_locked: number;
  accumulated_losses_qusd: number;
  bonus_repaid_usdc?: number;
  vault_activity_at?: number | null;
  sol_receive_address: string | null;
  /** Set after the user passes on-chain verification (address cannot be changed). */
  sol_receive_verified_at?: number | null;
  /** Optimistic concurrency with PUT /api/account/state and deposit worker. */
  sync_version?: number;
  /** Present on GET /api/account/me JSON only (joined from `perp_open_positions`). */
  open_perp_positions?: import("../engine/perps").PerpPosition[];
  /** True after at least one Solana USDC deposit was credited (`deposit_credits`). */
  account_active?: boolean;
  /** True when JWT email matches server `ADMIN_EMAIL` (sidebar Visitors, admin APIs). */
  is_admin?: boolean;
};

export type PerpTxnType = "open" | "close";

/** One row per open or close event (append-only). */
export type PerpTransactionRow = {
  id: number;
  account_id: string;
  position_id: string;
  txn_type: PerpTxnType;
  symbol: string;
  side: "long" | "short";
  entry_price: number | null;
  notional_usdc: number | null;
  leverage: number | null;
  margin_usdc: number | null;
  opened_at: number | null;
  exit_price: number | null;
  realized_pnl_qusd: number | null;
  closed_at: number | null;
  inserted_at: number;
};
