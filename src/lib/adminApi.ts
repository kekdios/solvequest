/** Same-origin admin API (Vite dev/preview middleware). */
const base = "/api/admin";

export type AdminMeResponse = { ok: boolean; authenticated: boolean; pubkey?: string };

/** GET /api/admin/custody-debug — requires admin session. Owner from server env SOLVEQUEST_ADMIN_CUSTODY_OWNER. */
export type AdminCustodyDebugResponse = {
  ok: true;
  configured: boolean;
  owner: string | null;
  usdc_ata: string | null;
  usdc_mint: string;
  sol_lamports: number | null;
  usdc_balance_ui: number | null;
  ata_exists: boolean;
  recent_signatures: { signature: string; slot: number | null; blockTime: number | null }[];
  rpc_url: string;
  rpc_error?: string;
};

export async function fetchAdminCustodyDebug(): Promise<AdminCustodyDebugResponse> {
  const r = await fetch(`${base}/custody-debug`, { credentials: "include" });
  const data = (await r.json()) as AdminCustodyDebugResponse | { ok?: false; error?: string };
  if (r.status === 401) {
    throw new Error("Not signed in");
  }
  if (!r.ok || !data || typeof data !== "object" || !("ok" in data) || !data.ok) {
    throw new Error(typeof data === "object" && data && "error" in data ? String(data.error) : r.statusText);
  }
  return data as AdminCustodyDebugResponse;
}

export async function fetchAdminMe(): Promise<AdminMeResponse> {
  const r = await fetch(`${base}/me`, { credentials: "include" });
  return r.json() as Promise<AdminMeResponse>;
}

export async function fetchAdminNonce(): Promise<{ ok: true; nonce: string; message: string }> {
  const r = await fetch(`${base}/nonce`, { credentials: "include" });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: string };
    const msg =
      r.status === 503
        ? "Admin API disabled — set ADMIN_SOLANA_ADDRESS in .env and restart the dev server."
        : err.error ?? r.statusText;
    throw new Error(msg);
  }
  return r.json() as Promise<{ ok: true; nonce: string; message: string }>;
}

export async function postAdminVerify(body: {
  nonce: string;
  message: string;
  pubkey: string;
  signature: string;
}): Promise<{ ok: true; pubkey: string }> {
  const r = await fetch(`${base}/verify`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(typeof data === "object" && data && "error" in data ? String((data as { error?: string }).error) : r.statusText);
  }
  return data as { ok: true; pubkey: string };
}

export async function postAdminLogout(): Promise<void> {
  await fetch(`${base}/logout`, { method: "POST", credentials: "include" });
}

/** Runs one server-side Solana USDC deposit scan for all accounts (admin session required). */
export type AdminCustodialSweepStep = {
  id: string;
  label: string;
  status: "ok" | "error" | "skipped";
  detail?: string;
};

export type AdminCustodialSweepResponse =
  | {
      ok: true;
      account_id: string;
      owner: string;
      steps: AdminCustodialSweepStep[];
      sweep_signature?: string;
      remaining_usdc_ui?: number;
    }
  | { ok: false; steps: AdminCustodialSweepStep[]; error: string; account_id?: string };

/** Guided custodial sweep: sync credits → verify ledger → sweep → verify (uses SOLVEQUEST_ADMIN_CUSTODY_OWNER or body.account_id). */
export async function postAdminCustodialSweep(body?: {
  account_id?: string;
}): Promise<AdminCustodialSweepResponse> {
  const r = await fetch(`${base}/custodial-sweep`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await r.json()) as AdminCustodialSweepResponse & { error?: string };
  if (r.status === 401) {
    throw new Error("Not signed in");
  }
  if (r.status === 500) {
    return {
      ok: false,
      error: data?.error ?? r.statusText,
      steps: Array.isArray(data?.steps) ? data.steps : [],
    };
  }
  if (!data || typeof data !== "object") {
    throw new Error("Bad response");
  }
  return data as AdminCustodialSweepResponse;
}

export async function postAdminDepositScan(): Promise<{ ok: true; accountsScanned: number }> {
  const r = await fetch(`${base}/deposit-scan`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; accountsScanned?: number; error?: string };
  if (!r.ok) {
    throw new Error(data.error ?? r.statusText);
  }
  if (!data.ok || typeof data.accountsScanned !== "number") {
    throw new Error("unexpected_response");
  }
  return { ok: true, accountsScanned: data.accountsScanned };
}

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}
