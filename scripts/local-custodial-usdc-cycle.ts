#!/usr/bin/env npx tsx
/**
 * Standalone: derive custodial owner + mainnet USDC ATA from the same env as the API
 * (VITE_SOLANA_TEST_SECRET_KEY_B64 or SOLANA_TEST_SECRET_KEY_B64 / SOLANA_CUSTODIAL_MASTER_KEY_B64).
 *
 * Usage:
 *   npx tsx scripts/local-custodial-usdc-cycle.ts
 *   npx tsx scripts/local-custodial-usdc-cycle.ts --index 2
 *   npx tsx scripts/local-custodial-usdc-cycle.ts --watch
 *   npx tsx scripts/local-custodial-usdc-cycle.ts --watch --rpc https://api.mainnet-beta.solana.com
 *
 * Then send ~0.1 USDC to the printed **USDC ATA** (not the owner) from any mainnet wallet.
 * With --watch, polls RPC until the ATA has a balance (on-chain confirmation only; app DB credit is separate).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Connection } from "@solana/web3.js";
import { deriveCustodialKeypairFromIndex } from "../server/custodialHdDerive";
import { getUsdcAta, MAINNET_USDC_MINT } from "../server/solanaUsdcScan";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
dotenv.config({ path: path.join(root, ".env") });

function parseArgs(): { index: number; watch: boolean; rpc: string; intervalMs: number } {
  const args = process.argv.slice(2);
  let index = 0;
  let watch = false;
  let rpc = process.env.SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";
  let intervalMs = 5000;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--index" && args[i + 1] != null) {
      index = Number.parseInt(args[++i], 10);
      if (!Number.isInteger(index) || index < 0) {
        throw new Error("--index must be a non-negative integer");
      }
    } else if (a === "--watch") {
      watch = true;
    } else if (a === "--rpc" && args[i + 1] != null) {
      rpc = args[++i]!.trim();
    } else if (a === "--interval-ms" && args[i + 1] != null) {
      intervalMs = Math.max(2000, Number.parseInt(args[++i]!, 10) || 5000);
    } else if (a === "--help" || a === "-h") {
      console.log(`See header comment in scripts/local-custodial-usdc-cycle.ts`);
      process.exit(0);
    }
  }
  return { index, watch, rpc, intervalMs };
}

async function main(): Promise<void> {
  const { index, watch, rpc, intervalMs } = parseArgs();
  const env = process.env;

  const kp = deriveCustodialKeypairFromIndex(index, env);
  const owner = kp.publicKey;
  const ata = getUsdcAta(owner);

  console.log("");
  console.log("=== Local custodial USDC (mainnet) — standalone ===");
  console.log("");
  console.log(`Derivation index: ${index}`);
  console.log(`HD path:          m/44'/501'/${index}'/0'`);
  console.log(`Owner (wallet):   ${owner.toBase58()}`);
  console.log(`USDC mint:        ${MAINNET_USDC_MINT.toBase58()}`);
  console.log("");
  console.log(">>> SEND USDC TO THIS ADDRESS (Associated Token Account) <<<");
  console.log(`    ${ata.toBase58()}`);
  console.log("");
  console.log("Send ~0.1 USDC from Phantom/Solflare/etc. Choose SPL token USDC, recipient = the ATA above.");
  console.log("(First inbound transfer creates the ATA if it does not exist yet.)");
  console.log("");

  if (!watch) {
    console.log("Re-run with --watch to poll RPC until USDC appears on that ATA.");
    console.log(`Default RPC: ${rpc}`);
    return;
  }

  const conn = new Connection(rpc, "confirmed");
  console.log(`Watching ATA (polling every ${intervalMs} ms)…`);
  console.log(`RPC: ${rpc}`);
  console.log("");

  for (;;) {
    const ts = new Date().toISOString();
    try {
      const bal = await conn.getTokenAccountBalance(ata);
      const ui = bal.value.uiAmount ?? Number(bal.value.uiAmountString ?? 0);
      const raw = bal.value.amount;
      console.log(`[${ts}] USDC balance: ${ui} (raw ${raw}, decimals ${bal.value.decimals})`);
      if (Number(raw) > 0) {
        console.log("");
        console.log("On-chain deposit detected.");
        console.log(
          "To credit inside Solve Quest: ensure an account row uses this owner as sol_receive_address with the same derivation index, then run deposit scan / admin tooling.",
        );
        return;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("could not find account") || msg.includes("Invalid param")) {
        console.log(`[${ts}] No ATA yet (or zero balance) — send USDC to create/fund it.`);
      } else {
        console.error(`[${ts}] RPC error:`, msg);
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
