/**
 * Canonical origin for the public app (override with VITE_MAIN_SITE_ORIGIN for local testing).
 */
export function getMainSitePublicOrigin(): string {
  const o = import.meta.env.VITE_MAIN_SITE_ORIGIN?.trim();
  if (o) return o.replace(/\/$/, "");
  if (typeof window === "undefined") return "https://solvequest.io";
  const { protocol, hostname, port } = window.location;
  return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
}
