/**
 * Split: main app on apex/www, operator admin UI only on the admin subdomain.
 * Override with VITE_ADMIN_HOST / VITE_MAIN_SITE_ORIGIN / VITE_ADMIN_ORIGIN for local testing.
 */
export function getConfiguredAdminHost(): string {
  const v = import.meta.env.VITE_ADMIN_HOST;
  if (typeof v === "string" && v.trim()) return v.trim().toLowerCase();
  return "admin.solvequest.io";
}

export function isAdminSubdomainHost(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname.toLowerCase() === getConfiguredAdminHost();
}

/** Canonical origin for the public app (apex / www). */
export function getMainSitePublicOrigin(): string {
  const o = import.meta.env.VITE_MAIN_SITE_ORIGIN?.trim();
  if (o) return o.replace(/\/$/, "");
  if (typeof window === "undefined") return "https://solvequest.io";
  const { protocol, hostname, port } = window.location;
  if (isAdminSubdomainHost()) {
    const apex = "solvequest.io";
    const p =
      (protocol === "https:" && port === "443") ||
      (protocol === "http:" && (port === "80" || port === "")) ||
      !port
        ? ""
        : `:${port}`;
    return `${protocol}//${apex}${p}`;
  }
  return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
}

/** Origin for the admin subdomain (redirects + links). */
export function getAdminPublicOrigin(): string {
  const o = import.meta.env.VITE_ADMIN_ORIGIN?.trim();
  if (o) return o.replace(/\/$/, "");
  if (typeof window === "undefined") return "https://admin.solvequest.io";
  const { protocol, port } = window.location;
  const host = getConfiguredAdminHost();
  const p =
    port && port !== "443" && port !== "80" && port !== ""
      ? `:${port}`
      : "";
  return `${protocol}//${host}${p}`;
}
