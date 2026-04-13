import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiPort = env.API_PORT?.trim() || "3001";
  const apiTarget = `http://127.0.0.1:${apiPort}`;
  const qusdMult =
    env.QUSD_MULTIPLIER?.trim() || env.VITE_QUSD_MULTIPLIER?.trim() || "100";
  return {
    plugins: [react()],
    define: {
      "import.meta.env.HYPERLIQUID_API_KEY": JSON.stringify(env.HYPERLIQUID_API_KEY ?? ""),
      "import.meta.env.HYPERLIQUID_INFO_URL": JSON.stringify(env.HYPERLIQUID_INFO_URL ?? ""),
      /** Same as server `QUSD_MULTIPLIER` — baked at build time for the SPA. */
      "import.meta.env.QUSD_MULTIPLIER": JSON.stringify(qusdMult),
    },
    server: {
      proxy: {
        "/api": { target: apiTarget, changeOrigin: true },
        "/solana-rpc": { target: apiTarget, changeOrigin: true },
      },
    },
    preview: {
      proxy: {
        "/api": { target: apiTarget, changeOrigin: true },
        "/solana-rpc": { target: apiTarget, changeOrigin: true },
      },
    },
  };
});
