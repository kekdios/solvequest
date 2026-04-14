/**
 * Admin-guided custodial sweep: sync deposits → verify QUSD credits → sweep USDC → verify ATA empty.
 */
import fs from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import type Database from "better-sqlite3";
import { parseQusdMultiplier } from "../src/lib/qusdMultiplier";
import { resolveCustodialDepositKeypair } from "./depositWalletCrypto";
import { getLedgerBalances } from "./qusdLedger";
import { sweepCustodialDepositToTreasury } from "./custodialSweepServer";
import { openDepositDatabase, processAccount, resolveDbPath, rpcUrl } from "./depositScanWorker";
import { getUsdcAta } from "./solanaUsdcScan";

type SqliteDb = InstanceType<typeof Database>;

export type CustodialSweepStep = {
  id: string;
  label: string;
  status: "ok" | "error" | "skipped";
  detail?: string;
};

export type CustodialSweepOrchestrationResult =
  | {
      ok: true;
      account_id: string;
      owner: string;
      steps: CustodialSweepStep[];
      sweep_signature?: string;
      remaining_usdc_ui?: number;
    }
  | { ok: false; steps: CustodialSweepStep[]; error: string; account_id?: string };

const USDC_EPS = 1e-4;

function push(
  steps: CustodialSweepStep[],
  id: string,
  label: string,
  status: CustodialSweepStep["status"],
  detail?: string,
) {
  steps.push({ id, label, status, detail });
}

function findAccount(
  database: SqliteDb,
  accountId: string | undefined,
  ownerFromEnv: string | undefined,
): { id: string; sol_receive_address: string } | null {
  if (accountId?.trim()) {
    const row = database
      .prepare(`SELECT id, sol_receive_address FROM accounts WHERE id = ?`)
      .get(accountId.trim()) as { id: string; sol_receive_address: string } | null;
    if (!row?.sol_receive_address?.trim()) return null;
    return { id: row.id, sol_receive_address: row.sol_receive_address.trim() };
  }
  const o = ownerFromEnv?.trim();
  if (!o) return null;
  const row = database
    .prepare(`SELECT id, sol_receive_address FROM accounts WHERE TRIM(sol_receive_address) = ?`)
    .get(o) as { id: string; sol_receive_address: string } | null;
  if (!row) return null;
  return { id: row.id, sol_receive_address: row.sol_receive_address.trim() };
}

async function usdcAtaBalanceUi(connection: Connection, owner: PublicKey): Promise<number> {
  const ata = getUsdcAta(owner);
  try {
    const t = await connection.getTokenAccountBalance(ata, "confirmed");
    return parseFloat(t.value.uiAmountString ?? "0");
  } catch {
    return 0;
  }
}

export async function runCustodialSweepOrchestration(
  appRoot: string,
  env: NodeJS.ProcessEnv,
  body: { account_id?: string },
): Promise<CustodialSweepOrchestrationResult> {
  const steps: CustodialSweepStep[] = [];
  const merged = { ...process.env, ...env } as NodeJS.ProcessEnv;
  const ownerEnv = (merged.SOLVEQUEST_ADMIN_CUSTODY_OWNER ?? "").trim();

  const dbPath = resolveDbPath(appRoot, merged);
  if (!fs.existsSync(dbPath)) {
    push(steps, "open_db", "Open database", "error", `Missing DB at ${dbPath}`);
    return { ok: false, steps, error: "Database file not found." };
  }

  let database: SqliteDb;
  try {
    database = openDepositDatabase(dbPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    push(steps, "open_db", "Open database", "error", msg);
    return { ok: false, steps, error: msg };
  }

  const account = findAccount(database, body.account_id, ownerEnv || undefined);
  if (!account) {
    database.close();
    const hint = body.account_id
      ? "account_id not found or missing sol_receive_address."
      : "Set SOLVEQUEST_ADMIN_CUSTODY_OWNER to the custodial owner base58, or pass account_id in the request body.";
    push(steps, "resolve_account", "Resolve account", "error", hint);
    return { ok: false, steps, error: `Could not resolve account. ${hint}` };
  }
  push(steps, "resolve_account", "Resolve account", "ok", `${account.id.slice(0, 8)}… · ${account.sol_receive_address}`);

  let ownerPk: PublicKey;
  try {
    ownerPk = new PublicKey(account.sol_receive_address);
  } catch {
    database.close();
    push(steps, "owner_valid", "Validate owner pubkey", "error", "Invalid sol_receive_address");
    return { ok: false, steps, error: "Invalid custodial owner public key.", account_id: account.id };
  }

  const qusdPerUsdc = parseQusdMultiplier(merged.QUSD_MULTIPLIER ?? merged.VITE_QUSD_MULTIPLIER);
  const connection = new Connection(rpcUrl(merged), "confirmed");

  try {
    try {
      await processAccount(
        database,
        connection,
        account.id,
        account.sol_receive_address,
        qusdPerUsdc,
        merged,
        { skipCustodialSweep: true },
      );
      push(steps, "sync_deposits", "Sync deposits & credit QUSD", "ok", "Scanned USDC ATA and applied new credits.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      push(steps, "sync_deposits", "Sync deposits & credit QUSD", "error", msg);
      return { ok: false, steps, error: `Deposit sync failed: ${msg}`, account_id: account.id };
    }

    let usdcBefore = 0;
    try {
      usdcBefore = await usdcAtaBalanceUi(connection, ownerPk);
      push(steps, "check_usdc", "Check on-chain USDC (custodial ATA)", "ok", `${usdcBefore.toFixed(6)} USDC`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      push(steps, "check_usdc", "Check on-chain USDC (custodial ATA)", "error", msg);
      return { ok: false, steps, error: `RPC error reading USDC: ${msg}`, account_id: account.id };
    }

    if (usdcBefore <= USDC_EPS) {
      push(
        steps,
        "verify_ledger",
        "Verify QUSD / deposit credits",
        "skipped",
        "No USDC in custodial ATA — nothing to sweep.",
      );
      push(steps, "sweep", "Sweep USDC to treasury", "skipped", "No funds to move.");
      push(steps, "verify_sweep", "Verify ATA after sweep", "skipped", "—");
      const { unlocked } = getLedgerBalances(database, account.id);
      push(steps, "qusd_balance", "QUSD (ledger, unlocked)", "ok", `${unlocked.toFixed(2)} QUSD`);
      return {
        ok: true,
        account_id: account.id,
        owner: account.sol_receive_address,
        steps,
        remaining_usdc_ui: usdcBefore,
      };
    }

    const creditedRow = database
      .prepare(
        `SELECT COALESCE(SUM(amount_human), 0) AS s FROM deposit_credits
         WHERE account_id = ? AND chain = 'solana' AND kind = 'usdc'`,
      )
      .get(account.id) as { s: number };
    const creditedUsdc = Number(creditedRow?.s ?? 0);
    const { unlocked: qusdUnlocked } = getLedgerBalances(database, account.id);

    if (creditedUsdc < USDC_EPS) {
      push(
        steps,
        "verify_ledger",
        "Verify QUSD / deposit credits",
        "error",
        `On-chain USDC ${usdcBefore.toFixed(4)} but no deposit_credits rows — run sync when RPC is healthy.`,
      );
      return {
        ok: false,
        steps,
        error:
          "USDC is on-chain but the app has not recorded USDC deposit credits (QUSD may be missing). Fix RPC/deposit scan, then retry.",
        account_id: account.id,
      };
    }

    if (creditedUsdc + 0.02 < usdcBefore) {
      push(
        steps,
        "verify_ledger",
        "Verify QUSD / deposit credits",
        "error",
        `Credited USDC sum ${creditedUsdc.toFixed(4)} is below on-chain ${usdcBefore.toFixed(4)} — wait for deposit sync.`,
      );
      return {
        ok: false,
        steps,
        error: "Recorded credits do not fully cover on-chain USDC. Run deposit sync again after RPC stabilizes.",
        account_id: account.id,
      };
    }

    push(
      steps,
      "verify_ledger",
      "Verify QUSD / deposit credits",
      "ok",
      `Credited ≈ ${creditedUsdc.toFixed(4)} USDC · unlocked QUSD ≈ ${qusdUnlocked.toFixed(2)}`,
    );

    const crow = database
      .prepare(`SELECT custodial_seckey_enc, custodial_derivation_index FROM accounts WHERE id = ?`)
      .get(account.id) as
      | { custodial_seckey_enc: string | null; custodial_derivation_index: number | null }
      | undefined;
    const kp = crow ? resolveCustodialDepositKeypair(crow, merged) : null;
    if (!kp) {
      push(
        steps,
        "sweep",
        "Sweep USDC to treasury",
        "error",
        "Cannot derive custodial signing key (set custodial_derivation_index / master key).",
      );
      return {
        ok: false,
        steps,
        error: "Custodial keypair unavailable for sweep.",
        account_id: account.id,
      };
    }

    const sweepResult = await sweepCustodialDepositToTreasury(connection, merged, kp);
    if (!sweepResult.ok) {
      push(steps, "sweep", "Sweep USDC to treasury", "error", sweepResult.reason);
      return {
        ok: false,
        steps,
        error: `Sweep failed: ${sweepResult.reason}`,
        account_id: account.id,
      };
    }

    push(
      steps,
      "sweep",
      "Sweep USDC to treasury",
      "ok",
      `Swept ${sweepResult.sweptUsdc.toFixed(4)} USDC · tx ${sweepResult.signature.slice(0, 12)}…`,
    );

    let remaining = 0;
    try {
      remaining = await usdcAtaBalanceUi(connection, ownerPk);
      if (remaining > 0.01) {
        push(steps, "verify_sweep", "Verify custodial ATA is empty", "error", `${remaining.toFixed(4)} USDC still on ATA`);
        return {
          ok: false,
          steps,
          error: `Sweep tx submitted but ATA still shows ${remaining.toFixed(4)} USDC — check Solscan.`,
          account_id: account.id,
        };
      }
      push(steps, "verify_sweep", "Verify custodial ATA is empty", "ok", `Remaining USDC ≈ ${remaining.toFixed(6)}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      push(steps, "verify_sweep", "Verify custodial ATA is empty", "error", msg);
      return { ok: false, steps, error: `Post-sweep verification failed: ${msg}`, account_id: account.id };
    }

    return {
      ok: true,
      account_id: account.id,
      owner: account.sol_receive_address,
      steps,
      sweep_signature: sweepResult.signature,
      remaining_usdc_ui: remaining,
    };
  } finally {
    try {
      database.close();
    } catch {
      /* ignore */
    }
  }
}
