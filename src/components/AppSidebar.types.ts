export type AppScreen =
  | "landing"
  | "quickstart"
  | "trade"
  | "swap"
  | "history"
  | "sellQusd"
  | "leaderboard"
  | "account"
  | "visitors"
  | "admin"
  | "auth"
  | "terms"
  | "privacy"
  /** Linked from landing only — not in sidebar. */
  | "agentPuzzle";
