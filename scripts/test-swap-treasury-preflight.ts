#!/usr/bin/env npx tsx
/**
 * Replicates `treasury_ready` from GET /api/swap/preflight (plugins/swapApiPlugin.ts).
 * Usage: npx tsx scripts/test-swap-treasury-preflight.ts [SOLANA_TREASURY_ADDRESS]
 * Loads `.env` from repo root (SWAP_* and SOLANA_RPC_*).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Connection, PublicKey } from "@solana/web3.js";
import { getUsdcAtaBalanceUi } from "../server/solanaUsdcScan";

const MIN_TREASURY_SOL_LAMPORTS = 1_000_000;

function parseEnvNumber(raw: string | undefined, fallback: number): number {
  const n = Number.parseFloat((raw ?? "").trim());
  return Number.isFinite(n) ? n : fallback;
}

function rpcUrl(env: NodeJS.ProcessEnv): string {
  return (
    env.SOLANA_RPC_URL?.trim() || env.SOLANA_RPC_PROXY_TARGET?.trim() || "https://api.mainnet-beta.solana.com"
  );
}

async function main(): Promise<void> {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  dotenv.config({ path: path.join(root, ".env") });

  const addrArg = process.argv[2]?.trim();
  const treasuryPkStr = addrArg || process.env.SOLANA_TREASURY_ADDRESS?.trim() || "";
  if (!treasuryPkStr) {
    console.error("Usage: npx tsx scripts/test-swap-treasury-preflight.ts [SOLANA_TREASURY_ADDRESS]");
    process.exit(1);
  }

  const env = process.env;
  const swapAbove = parseEnvNumber(env.SWAP_ABOVE_AMOUNT, 0);
  const swapRate = parseEnvNumber(env.SWAP_QUSD_USDC_RATE, 0);
  const swapMaxUsdc = parseEnvNumber(env.SWAP_MAXIMUM_USDC_AMOUNT, 0);

  let treasuryPk: PublicKey;
  try {
    treasuryPk = new PublicKey(treasuryPkStr);
  } catch {
    console.error("Invalid treasury address.");
    process.exit(1);
  }

  const connection = new Connection(rpcUrl(env), "confirmed");
  const rpc = rpcUrl(env);
  console.log("RPC:", rpc.length > 64 ? `${rpc.slice(0, 64)}…` : rpc);
  console.log("Treasury:", treasuryPk.toBase58());
  console.log(
    "Env: SWAP_ABOVE_AMOUNT=%s, SWAP_QUSD_USDC_RATE=%s, SWAP_MAXIMUM_USDC_AMOUNT=%s",
    swapAbove,
    swapRate,
    swapMaxUsdc,
  );
  console.log("");

  const treasuryUsdc = await getUsdcAtaBalanceUi(connection, treasuryPk);
  const treasurySolLamports = await connection.getBalance(treasuryPk, "confirmed");

  const usdcOk = treasuryUsdc > 0;
  const solOk = treasurySolLamports >= MIN_TREASURY_SOL_LAMPORTS;
  const envOk = swapAbove > 0 && swapRate > 0 && swapMaxUsdc > 0;
  const treasuryReady = usdcOk && solOk && envOk;

  console.log(
    "Treasury USDC (mainnet ATA, human):",
    treasuryUsdc.toFixed(6),
    "→",
    usdcOk ? "OK (> 0)" : "FAIL (need > 0 USDC in treasury ATA)",
  );
  console.log(
    "Treasury SOL:",
    (treasurySolLamports / 1e9).toFixed(6),
    `SOL (${treasurySolLamports} lamports) →`,
    solOk ? `OK (≥ ${MIN_TREASURY_SOL_LAMPORTS} lamports)` : `FAIL (need ≥ 0.001 SOL for fees)`,
  );
  console.log(
    "Swap env configured:",
    envOk ? "OK" : "FAIL",
    `(above>0: ${swapAbove > 0}, rate>0: ${swapRate > 0}, maxUsdc>0: ${swapMaxUsdc > 0})`,
  );
  console.log("");
  console.log("treasury_ready (same as GET /api/swap/preflight):", treasuryReady);
  console.log(
    "Swap page shows ‘Swaps are paused…’ when preflight has treasury_ready === false:",
    !treasuryReady,
  );

  if (!treasuryReady) {
    console.log("\nWhat failed:");
    if (!usdcOk) console.log("  • USDC: fund the treasury’s USDC associated token account on mainnet.");
    if (!solOk) console.log("  • SOL: treasury needs at least 0.001 SOL on the main wallet for tx fees.");
    if (!envOk) console.log("  • Env: set SWAP_ABOVE_AMOUNT, SWAP_QUSD_USDC_RATE, SWAP_MAXIMUM_USDC_AMOUNT.");
  }
}

void main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
