#!/usr/bin/env npx tsx
/**
 * Diagnose USDC → QUSD deposit path for a Solana receive address.
 * Usage: npx tsx scripts/diagnose-usdc-deposit.ts <solana_address> [path/to/solvequest.db]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import { Connection, PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import {
  getUsdcAta,
  getUsdcAtaBalanceUi,
  MAINNET_USDC_MINT,
  READ_COMMITMENT,
  usdcNetChangeForWallet,
} from "../server/solanaUsdcScan";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

function rpcUrl(): string {
  return (
    process.env.SOLANA_RPC_URL?.trim() ||
    process.env.SOLANA_RPC_PROXY_TARGET?.trim() ||
    "https://api.mainnet-beta.solana.com"
  );
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function getParsedTransactionReliable(
  connection: Connection,
  signature: string,
): Promise<ParsedTransactionWithMeta | null> {
  const opts = { commitment: READ_COMMITMENT, maxSupportedTransactionVersion: 0 as const };
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await connection.getParsedTransaction(signature, opts);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("429") && attempt < 5) {
        await sleep(6000 + attempt * 2000);
        continue;
      }
      throw e;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const addr = process.argv[2]?.trim();
  const dbPathArg = process.argv[3]?.trim();
  if (!addr) {
    console.error("Usage: npx tsx scripts/diagnose-usdc-deposit.ts <solana_address> [solvequest.db]");
    process.exit(1);
  }

  let owner: PublicKey;
  try {
    owner = new PublicKey(addr);
  } catch {
    console.error("Invalid Solana address.");
    process.exit(1);
  }

  const connection = new Connection(rpcUrl(), "confirmed");
  const ata = getUsdcAta(owner);
  const sigLimit = Math.min(
    15,
    Math.max(1, Number.parseInt(process.env.DIAGNOSE_USDC_SIG_LIMIT || "10", 10) || 10),
  );
  const ui = await getUsdcAtaBalanceUi(connection, owner);

  console.log("=== On-chain (mainnet) ===");
  console.log("Owner:", owner.toBase58());
  console.log("USDC mint:", MAINNET_USDC_MINT.toBase58());
  console.log("USDC ATA:", ata.toBase58());
  console.log("Current USDC balance (ATA, human):", ui.toFixed(6));
  console.log("RPC:", rpcUrl().slice(0, 56) + "…");
  console.log("");

  const sigs = await connection.getSignaturesForAddress(ata, { limit: sigLimit }, READ_COMMITMENT);
  // Public mainnet RPC often 429s on burst getParsedTransaction; pace before heavy calls.
  await sleep(1500);
  console.log(`=== Recent USDC ATA signatures (newest first, up to ${sigLimit}) ===`);
  if (sigs.length === 0) {
    console.log("No signatures — ATA may never have been used (no USDC received on canonical ATA).");
  }
  for (let i = 0; i < sigs.length; i++) {
    const s = sigs[i]!;
    if (i > 0) await sleep(2000);
    const tx = await getParsedTransactionReliable(connection, s.signature);
    const amt = tx ? usdcNetChangeForWallet(tx as ParsedTransactionWithMeta, owner) : -1;
    console.log(
      s.signature.slice(0, 20) + "…",
      "slot",
      s.slot,
      "err",
      s.err ? JSON.stringify(s.err) : "ok",
      "| net USDC to wallet (parsed):",
      amt >= 0 ? amt.toFixed(6) : "(no parse)",
    );
  }
  console.log("");

  const defaultDb = process.env.SOLVEQUEST_DB_PATH?.trim() || path.join(root, "data", "solvequest.db");
  const dbPath = dbPathArg || defaultDb;
  if (!fs.existsSync(dbPath)) {
    console.log("=== SQLite (skipped — file missing) ===");
    console.log("Tried:", dbPath);
    console.log("Pass db path as 2nd arg or set SOLVEQUEST_DB_PATH.");
  } else {
  const db = new Database(dbPath);
  try {
    db.pragma("foreign_keys = ON");
    const rows = db
      .prepare(
        `SELECT id, email, sol_receive_address,
                (SELECT COALESCE(SUM(amount_human),0) FROM deposit_credits WHERE account_id = accounts.id AND chain = 'solana' AND kind = 'usdc') AS credited_usdc
         FROM accounts
         WHERE sol_receive_address = ? OR TRIM(LOWER(sol_receive_address)) = TRIM(LOWER(?))`,
      )
      .all(owner.toBase58(), owner.toBase58()) as {
      id: string;
      email: string | null;
      sol_receive_address: string | null;
      credited_usdc: number;
    }[];

    console.log("=== SQLite:", dbPath, "===");
    try {
      const twm = db
        .prepare(`SELECT watermark_signature FROM deposit_treasury_scan WHERE id = 1`)
        .get() as { watermark_signature: string | null } | undefined;
      console.log("deposit_treasury_scan watermark:", twm?.watermark_signature ?? "(none)");
    } catch {
      console.log("deposit_treasury_scan: (table missing — run server once to migrate)");
    }
    if (rows.length === 0) {
      console.log("No account row with sol_receive_address matching this pubkey.");
      console.log("The wallet must be saved on Account (verify flow) for the worker to scan it.");
    } else {
      for (const r of rows) {
        console.log("account_id:", r.id);
        console.log("email:", r.email ?? "(null)");
        console.log("sol_receive_address:", r.sol_receive_address);
        console.log("Sum deposit_credits (USDC human):", r.credited_usdc);
        const wm = db
          .prepare(`SELECT watermark_signature FROM deposit_scan_state WHERE account_id = ?`)
          .get(r.id) as { watermark_signature: string | null } | undefined;
        console.log("deposit_scan_state watermark:", wm?.watermark_signature ?? "(none)");
        const recent = db
          .prepare(
            `SELECT signature, amount_human, credited_at FROM deposit_credits
             WHERE account_id = ? AND chain = 'solana' AND kind = 'usdc' ORDER BY credited_at DESC LIMIT 5`,
          )
          .all(r.id) as { signature: string; amount_human: number; credited_at: number }[];
        console.log("Recent deposit_credits:", recent.length ? recent : "(none)");
      }
    }
  } finally {
    db.close();
  }
  }

  console.log("");
  console.log("=== Hints ===");
  console.log(
    "- For reliable RPC (avoid 429 on this script), set SOLANA_RPC_URL in .env to a paid or dedicated endpoint.",
  );
  console.log(
    "- QUSD credit requires SOLVEQUEST_DEPOSIT_SCAN=1 and accounts.sol_receive_address equal to the **sender** wallet of USDC sent to the treasury USDC ATA.",
  );
  console.log(
    "- Treasury = SWAP_USDC_RECEIVE_ADDRESS if set, else SOLANA_TREASURY_ADDRESS (see server/treasuryUsdcDepositScan.ts).",
  );
  console.log("- This script still lists your wallet USDC ATA activity; credits are attributed from treasury inbound txs, not from your ATA balance alone.");
}

void main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
