/**
 * In-process heartbeat for the USDC→QUSD deposit scan worker (same Node process as the API).
 */
let lastSuccessfulTickAt: number | null = null;

export function recordDepositScanTickComplete(): void {
  lastSuccessfulTickAt = Date.now();
}

export function getDepositScanIntervalMs(env: NodeJS.ProcessEnv): number {
  return Math.max(
    10_000,
    Number.parseInt(env.SOLVEQUEST_DEPOSIT_SCAN_INTERVAL_MS ?? "45000", 10) || 45_000,
  );
}

export function isDepositScanWorkerEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.SOLVEQUEST_DEPOSIT_SCAN === "1" || env.SOLVEQUEST_DEPOSIT_SCAN === "true";
}

export type DepositScanHealthJson = {
  worker_enabled: boolean;
  interval_ms: number;
  last_tick_at: number | null;
  /** `disabled` | `starting` | `ok` | `stale` */
  status: "disabled" | "starting" | "ok" | "stale";
};

/** Stale if no successful tick within 3× the configured interval (worker likely stuck or crashed). */
export function getDepositScanHealth(env: NodeJS.ProcessEnv): DepositScanHealthJson {
  const worker_enabled = isDepositScanWorkerEnabled(env);
  const interval_ms = getDepositScanIntervalMs(env);
  if (!worker_enabled) {
    return { worker_enabled, interval_ms, last_tick_at: null, status: "disabled" };
  }
  if (lastSuccessfulTickAt == null) {
    return { worker_enabled, interval_ms, last_tick_at: null, status: "starting" };
  }
  const ageMs = Date.now() - lastSuccessfulTickAt;
  const staleAfterMs = interval_ms * 3;
  const status = ageMs > staleAfterMs ? "stale" : "ok";
  return { worker_enabled, interval_ms, last_tick_at: lastSuccessfulTickAt, status };
}
