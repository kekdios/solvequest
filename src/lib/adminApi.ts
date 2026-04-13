/** Same-origin admin API (Vite dev/preview middleware). */
const base = "/api/admin";

export type AdminMeResponse = { ok: boolean; authenticated: boolean; pubkey?: string };

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
