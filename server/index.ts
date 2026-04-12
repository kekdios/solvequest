/**
 * Express server: /api/* (auth, account, admin), Solana RPC proxy, static SPA + fallback.
 */
import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProxyMiddleware } from "http-proxy-middleware";
import { createUserAuthMiddleware } from "../plugins/userAuthApiPlugin";
import { createAccountApiMiddleware } from "../plugins/accountApiPlugin";
import { createAdminApiMiddleware } from "../plugins/adminApiPlugin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const appVersion = (() => {
  try {
    const raw = fs.readFileSync(path.join(root, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

function envRecord(): Record<string, string> {
  return { ...process.env } as Record<string, string>;
}

const isProd = process.env.NODE_ENV === "production";
const port = isProd
  ? Number(process.env.PORT || 3000)
  : Number(process.env.API_PORT || process.env.PORT || 3001);

const app = express();
const env = envRecord();
const mode = isProd ? "production" : "development";

app.get("/health", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true });
});
app.get("/version", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ version: appVersion });
});

app.use(createUserAuthMiddleware(env, mode));
app.use(createAccountApiMiddleware(env, root));
app.use(createAdminApiMiddleware(env, mode));

const solanaTarget =
  env.SOLANA_RPC_PROXY_TARGET?.trim() || "https://api.mainnet-beta.solana.com";
app.use(
  "/solana-rpc",
  createProxyMiddleware({
    target: solanaTarget,
    changeOrigin: true,
    secure: true,
    pathRewrite: (p) => p.replace(/^\/solana-rpc\/?/, "/") || "/",
    on: {
      proxyReq: (proxyReq) => {
        proxyReq.removeHeader("origin");
      },
    },
  }),
);

const distPath = path.join(root, "dist");
if (isProd) {
  if (!fs.existsSync(distPath)) {
    console.error(`[server] dist not found at ${distPath} — run npm run build first`);
    process.exit(1);
  }
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/solana-rpc")) {
      next();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    if (!req.accepts("html")) {
      res.status(404).end();
      return;
    }
    res.sendFile(path.join(distPath, "index.html"), (err) => {
      if (err) next(err);
    });
  });
}

app.listen(port, () => {
  if (isProd) {
    console.log(`[server] listening on ${port} (static + API)`);
  } else {
    console.log(
      `[server] API + Solana proxy on http://127.0.0.1:${port} — Vite proxies /api and /solana-rpc here`,
    );
  }
});
