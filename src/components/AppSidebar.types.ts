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
  /** Cursor AI prompt (Tetris spec) — linked from landing only; not in sidebar. */
  | "agentPuzzle";
