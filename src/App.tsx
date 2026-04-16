import { useCallback, useEffect, useReducer, useRef, useState, type CSSProperties } from "react";
import { SessionAuthProvider, useAuthMode, isDemoMode, useSessionAuth } from "./auth/sessionAuth";
import { getDefaultDemoAppState, loadDemoAppState, saveDemoAppState } from "./lib/demoPersistence";
import { buildAccountStatePutBody, putAccountState, type AccountStatePutBody } from "./lib/accountSync";
import type { DemoAppState, DemoLogEntry, PerpCloseSyncEvent } from "./lib/demoSessionTypes";
import { INITIAL_SESSION_WARN_FLAGS } from "./lib/demoSessionTypes";
import { syncEquity } from "./engine/accountCore";
import { fetchHyperliquidMids, HL_POLL_INTERVAL_MS } from "./engine/hyperliquid";
import {
  computeUnrealizedPnl,
  isLiquidatedAtMark,
  type PerpPosition,
  type PerpSymbol,
} from "./engine/perps";
import type { PersistedAccountRow } from "./db/persistedAccount";
import { persistedRowToAppSlice } from "./lib/accountHydration";
import PerpsTradeScreen from "./screens/PerpsTradeScreen";
import LandingPage from "./screens/LandingPage";
import AccountScreen from "./screens/AccountScreen";
import QuickStartScreen from "./screens/QuickStartScreen";
import HistoryScreen from "./screens/HistoryScreen";
import QusdSellScreen from "./screens/QusdSellScreen";
import VisitorsScreen from "./screens/VisitorsScreen";
import LeaderboardScreen from "./screens/LeaderboardScreen";
import AuthScreen from "./screens/AuthScreen";
import AppSidebar, { type AppScreen } from "./components/AppSidebar";

type State = DemoAppState;

type Action =
  | { type: "deposit"; amount: number }
  | { type: "setMarks"; marks: Record<PerpSymbol, number> }
  | {
      type: "perpOpen";
      symbol: PerpSymbol;
      side: "long" | "short";
      notionalUsdc: number;
      leverage: number;
    }
  | { type: "perpClose"; positionId: string; reason?: "liquidation" }
  | {
      type: "hydrateFromAccountRow";
      row: PersistedAccountRow;
      keepLocalPendingPerpCloses?: boolean;
      /** When true, keep local open positions not yet in SQLite (debounced PUT). First login should use false so demo/local junk is not merged. */
      mergeUnsyncedLocalOpens: boolean;
    }
  | { type: "replaceAll"; state: DemoAppState }
  /** Remove only closes included in a successful PUT — never drop newer closes added while a PUT was in flight. */
  | { type: "perpClosesAcked"; positionIds: string[] };

function pushLog(log: DemoLogEntry[], entry: Omit<DemoLogEntry, "id" | "t">): DemoLogEntry[] {
  return [
    ...log,
    { ...entry, id: crypto.randomUUID(), t: Date.now() },
  ].slice(-80);
}

function positionIdsAckedInPut(body: AccountStatePutBody): string[] {
  return (body.perp_close_events ?? []).map((e) => e.positionId);
}

function reducer(state: State, action: Action): State {
  const { account, log } = state;

  switch (action.type) {
    case "deposit": {
      if (action.amount <= 0) return state;
      const next = {
        ...account,
        balance: account.balance + action.amount,
      };
      return {
        ...state,
        account: { ...next, equity: next.balance + next.unrealizedPnL },
        log: pushLog(log, { kind: "info", message: `Deposit +${action.amount} USDC` }),
      };
    }
    case "setMarks":
      return { ...state, marks: action.marks };
    case "perpOpen": {
      const { symbol, side, notionalUsdc, leverage } = action;
      /** `notionalUsdc` from UI = margin tokens bet; exposure = tokens × leverage. */
      const tokens = notionalUsdc;
      if (tokens <= 0 || leverage <= 0) return state;
      if (tokens > state.qusd.unlocked + 1e-9) return state;
      const mark = state.marks[symbol];
      const pos: PerpPosition = {
        id: crypto.randomUUID(),
        symbol,
        side,
        entryPrice: mark,
        notionalUsdc: tokens * leverage,
        leverage,
        marginUsdc: tokens,
        openedAt: Date.now(),
      };
      return {
        ...state,
        qusd: { unlocked: state.qusd.unlocked - tokens },
        account: syncEquity({ ...account }),
        perpPositions: [...state.perpPositions, pos],
        log: pushLog(log, {
          kind: "info",
          message: `Opened ${side} ${symbol} · ${tokens.toFixed(2)} QUSD margin · ${leverage}× @ ${mark.toFixed(4)}`,
        }),
      };
    }
    case "hydrateFromAccountRow": {
      const slice = persistedRowToAppSlice(action.row);
      const fromServer = action.row.open_perp_positions ?? [];
      const pendingCloseIds = new Set(
        (action.keepLocalPendingPerpCloses ? state.pendingPerpCloses : []).map((e) => e.positionId),
      );
      const fromServerFiltered = fromServer.filter((p) => !pendingCloseIds.has(p.id));

      let positions: PerpPosition[];
      let pendingLocal: PerpPosition[] = [];
      if (action.mergeUnsyncedLocalOpens) {
        const serverIds = new Set(fromServerFiltered.map((p) => p.id));
        pendingLocal = state.perpPositions.filter((p) => !serverIds.has(p.id));
        positions = [...fromServerFiltered, ...pendingLocal];
      } else {
        positions = fromServerFiltered;
      }

      /**
       * Server `qusd_unlocked` is SUM(ledger) — includes margin locks only after PUT lands.
       * Opens that exist only locally already had margin subtracted in the client; subtract that margin here
       * so we don’t show inflated unlocked on periodic GET /me.
       */
      const derivedUnlocked = slice.qusd.unlocked;
      const marginPendingOnServer = pendingLocal.reduce((s, p) => s + p.marginUsdc, 0);
      const unlocked = Math.max(0, derivedUnlocked - marginPendingOnServer);

      return {
        ...state,
        ...slice,
        qusd: {
          unlocked,
        },
        perpPositions: positions,
        /** HL index marks come only from {@link fetchHyperliquidMids}; keep them when syncing SQLite so we never show seed prices under a "live" feed badge. */
        marks: state.marks,
        sessionWarnFlags: INITIAL_SESSION_WARN_FLAGS,
        pendingPerpCloses: action.keepLocalPendingPerpCloses ? (state.pendingPerpCloses ?? []) : [],
        log: pushLog([], {
          kind: "info",
          message: "Loaded account balances from the server database.",
        }),
      };
    }
    case "replaceAll":
      return action.state;
    case "perpClosesAcked": {
      const drop = new Set(action.positionIds);
      if (drop.size === 0) return state;
      return {
        ...state,
        pendingPerpCloses: (state.pendingPerpCloses ?? []).filter((e) => !drop.has(e.positionId)),
      };
    }
    case "perpClose": {
      const pos = state.perpPositions.find((p) => p.id === action.positionId);
      if (!pos) return state;
      const mark = state.marks[pos.symbol];
      const upl = computeUnrealizedPnl(pos, mark);
      const margin = pos.marginUsdc;
      const nextPositions = state.perpPositions.filter((p) => p.id !== action.positionId);
      /** Settlement: return margin + realized PnL to unlocked QUSD. */
      const creditQusd = margin + upl;
      let nextUnlocked = state.qusd.unlocked + creditQusd;
      if (nextUnlocked < 0) nextUnlocked = 0;
      const liquidated = action.reason === "liquidation";
      const msg = liquidated
        ? upl >= 0
          ? `Liquidated ${pos.symbol} ${pos.side} · margin exhausted · +${upl.toFixed(2)} QUSD`
          : `Liquidated ${pos.symbol} ${pos.side} · margin exhausted · ${upl.toFixed(2)} QUSD`
        : upl >= 0
          ? `Closed ${pos.symbol} ${pos.side} · Realized +${upl.toFixed(2)} QUSD (margin + PnL)`
          : `Closed ${pos.symbol} ${pos.side} · Realized ${upl.toFixed(2)} QUSD (margin + PnL)`;
      const closedAt = Date.now();
      const closeEvt: PerpCloseSyncEvent = {
        positionId: pos.id,
        symbol: pos.symbol,
        side: pos.side,
        entryPrice: pos.entryPrice,
        exitPrice: mark,
        notionalUsdc: pos.notionalUsdc,
        leverage: pos.leverage,
        marginUsdc: pos.marginUsdc,
        openedAt: pos.openedAt,
        realizedPnlQusd: upl,
        closedAt,
      };
      return {
        ...state,
        account: syncEquity({ ...account }),
        qusd: { unlocked: nextUnlocked },
        perpPositions: nextPositions,
        pendingPerpCloses: [...(state.pendingPerpCloses ?? []), closeEvt],
        log: pushLog(log, { kind: upl >= 0 ? "info" : "loss", message: msg }),
      };
    }
    default:
      return state;
  }
}

const SCREEN_HEADER: Record<AppScreen, { title: string; lead: string }> = {
  landing: {
    title: "",
    lead: "",
  },
  quickstart: {
    title: "Quick Start",
    lead: "From QUSD basics to your first trade in a few steps.",
  },
  trade: {
    title: "Trade",
    lead: "",
  },
  history: {
    title: "History",
    lead: "Closed perpetual trades (newest first).",
  },
  sellQusd: {
    title: "Prize",
    lead: "Prize pool, QUEST purchase with QUSD, and balances.",
  },
  leaderboard: {
    title: "Leaderboard",
    lead: "Top QUSD balances and prize pool details.",
  },
  account: {
    title: "Account",
    lead: "",
  },
  visitors: {
    title: "Visitors",
    lead: "Recent SPA views (IP, location, page).",
  },
  auth: {
    title: "Login / Register",
    lead: "Email code — register or sign in. Optional 7-day remember-me.",
  },
};

function AppInner() {
  const authMode = useAuthMode();
  const { user, logout, authLoading } = useSessionAuth();
  const demo = isDemoMode(authMode);

  const [ledgerAccountRow, setLedgerAccountRow] = useState<PersistedAccountRow | null>(null);
  /** Set when GET /api/account/me fails; shown on Account deposit UI. */
  const [ledgerHydrationError, setLedgerHydrationError] = useState<string | null>(null);

  const clearSessionAndLedger = useCallback(async () => {
    setLedgerAccountRow(null);
    setLedgerHydrationError(null);
    await logout();
  }, [logout]);

  const [state, dispatch] = useReducer(
    reducer,
    undefined,
    () => loadDemoAppState() ?? getDefaultDemoAppState(),
  );

  const stateRef = useRef(state);
  stateRef.current = state;

  const demoPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accountSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Server `sync_version` — must match PUT /api/account/state; deposit worker bumps it too. */
  const syncVersionRef = useRef(0);

  const refreshAccountFromServer = useCallback(async () => {
    try {
      const r = await fetch("/api/account/me", { credentials: "include" });
      if (r.status === 401) {
        await clearSessionAndLedger();
        return;
      }
      if (!r.ok) return;
      const data = (await r.json()) as PersistedAccountRow;
      setLedgerHydrationError(null);
      setLedgerAccountRow(data);
      syncVersionRef.current = Number(data.sync_version ?? 0);
      dispatch({
        type: "hydrateFromAccountRow",
        row: data,
        keepLocalPendingPerpCloses: true,
        mergeUnsyncedLocalOpens: true,
      });
    } catch {
      /* ignore */
    }
  }, [clearSessionAndLedger]);

  useEffect(() => {
    if (!demo) return;
    if (demoPersistTimer.current) clearTimeout(demoPersistTimer.current);
    demoPersistTimer.current = setTimeout(() => {
      saveDemoAppState(state);
      demoPersistTimer.current = null;
    }, 400);
    return () => {
      if (demoPersistTimer.current) clearTimeout(demoPersistTimer.current);
    };
  }, [demo, state]);

  /** Registered: persist trading state to SQLite (debounced). Omits `marks` from deps so HL polls do not reset the timer (was delaying / losing close syncs). */
  useEffect(() => {
    if (demo || !user?.email || authLoading || !ledgerAccountRow) return;
    if (accountSyncTimer.current) clearTimeout(accountSyncTimer.current);
    const delay = (state.pendingPerpCloses?.length ?? 0) > 0 ? 120 : 450;
    accountSyncTimer.current = setTimeout(() => {
      void (async () => {
        const body = buildAccountStatePutBody(stateRef.current, syncVersionRef.current);
        const result = await putAccountState(body);
        accountSyncTimer.current = null;
        if (result.ok) {
          syncVersionRef.current = result.sync_version;
          dispatch({ type: "perpClosesAcked", positionIds: positionIdsAckedInPut(body) });
          return;
        }
        if (!("conflict" in result) || !result.conflict) return;
        syncVersionRef.current = result.sync_version;
        const r = await fetch("/api/account/me", { credentials: "include" });
        if (r.status === 401) {
          void clearSessionAndLedger();
          return;
        }
        if (!r.ok) return;
        const data = (await r.json()) as PersistedAccountRow;
        setLedgerAccountRow(data);
        dispatch({
          type: "hydrateFromAccountRow",
          row: data,
          keepLocalPendingPerpCloses: true,
          mergeUnsyncedLocalOpens: true,
        });
        syncVersionRef.current = Number(data.sync_version ?? 0);
        const retryBody = buildAccountStatePutBody(stateRef.current, syncVersionRef.current);
        const retry = await putAccountState(retryBody);
        if (retry.ok) {
          syncVersionRef.current = retry.sync_version;
          dispatch({ type: "perpClosesAcked", positionIds: positionIdsAckedInPut(retryBody) });
        }
      })();
    }, delay);
    return () => {
      if (accountSyncTimer.current) clearTimeout(accountSyncTimer.current);
    };
  }, [
    demo,
    user?.email,
    authLoading,
    ledgerAccountRow,
    clearSessionAndLedger,
    state.perpPositions,
    state.pendingPerpCloses,
    state.qusd.unlocked,
    state.account.balance,
    state.account.plan.coverageLimit,
    state.account.premiumAccrued,
    state.account.coveredLosses,
    state.account.coverageUsed,
    state.accumulatedLossesQusd,
    state.bonusRepaidUsdc,
  ]);

  useEffect(() => {
    if (!demo) return;
    const flush = () => saveDemoAppState(stateRef.current);
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [demo]);

  useEffect(() => {
    if (demo || !user?.email || !ledgerAccountRow) return;
    const flush = () => {
      void (async () => {
        const body = buildAccountStatePutBody(stateRef.current, syncVersionRef.current);
        const result = await putAccountState(body);
        if (result.ok) {
          syncVersionRef.current = result.sync_version;
          dispatch({ type: "perpClosesAcked", positionIds: positionIdsAckedInPut(body) });
        }
      })();
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [demo, user?.email, ledgerAccountRow]);

  /** Anonymous session: restore demo from localStorage. Signed-in uses SQLite via hydrate effect. */
  useEffect(() => {
    if (authLoading) return;
    if (user) return;
    setLedgerAccountRow(null);
    setLedgerHydrationError(null);
    dispatch({ type: "replaceAll", state: loadDemoAppState() ?? getDefaultDemoAppState() });
  }, [authLoading, user]);

  /** Registered user: load `accounts` row from SQLite (GET /api/account/me). */
  useEffect(() => {
    if (authLoading || demo || !user) return;
    let cancelled = false;
    void (async () => {
      setLedgerHydrationError(null);
      try {
        const r = await fetch("/api/account/me", { credentials: "include" });
        if (r.status === 401) {
          if (!cancelled) await clearSessionAndLedger();
          return;
        }
        if (!r.ok) {
          let msg = `Could not load account (${r.status}).`;
          try {
            const j = (await r.json()) as { message?: string; error?: string };
            if (j.message) msg = j.message;
            else if (j.error) msg = String(j.error);
          } catch {
            /* ignore */
          }
          if (!cancelled) {
            setLedgerAccountRow(null);
            setLedgerHydrationError(msg);
          }
          return;
        }
        const data = (await r.json()) as PersistedAccountRow;
        if (cancelled) return;
        setLedgerHydrationError(null);
        setLedgerAccountRow(data);
        syncVersionRef.current = Number(data.sync_version ?? 0);
        dispatch({
          type: "hydrateFromAccountRow",
          row: data,
          mergeUnsyncedLocalOpens: false,
        });
      } catch (e) {
        if (!cancelled) {
          setLedgerAccountRow(null);
          setLedgerHydrationError(e instanceof Error ? e.message : "Network error loading account.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, demo, user?.email, clearSessionAndLedger]);

  /** Pick up on-chain deposit credits (server bumps sync_version). */
  useEffect(() => {
    if (demo || !user?.email || authLoading || !ledgerAccountRow) return;
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const r = await fetch("/api/account/me", { credentials: "include" });
          if (r.status === 401) {
            void clearSessionAndLedger();
            return;
          }
          if (!r.ok) return;
          const data = (await r.json()) as PersistedAccountRow;
          const sv = Number(data.sync_version ?? 0);
          if (sv <= syncVersionRef.current) return;
          if (data.sol_receive_address?.trim()) {
            setLedgerHydrationError(null);
          }
          setLedgerAccountRow(data);
          dispatch({
            type: "hydrateFromAccountRow",
            row: data,
            keepLocalPendingPerpCloses: true,
            mergeUnsyncedLocalOpens: true,
          });
          syncVersionRef.current = sv;
        } catch {
          /* ignore */
        }
      })();
    }, 25_000);
    return () => window.clearInterval(id);
  }, [demo, user?.email, authLoading, ledgerAccountRow?.id, clearSessionAndLedger]);

  const lastPopStateScreen = useRef<AppScreen>("landing");
  /** After session resolves, send logged-in users to Trade once per page load (not when they choose Home). */
  const openedLoggedInToTrade = useRef(false);

  const [screen, setScreen] = useState<AppScreen>("landing");

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      openedLoggedInToTrade.current = false;
      return;
    }
    if (openedLoggedInToTrade.current) return;
    openedLoggedInToTrade.current = true;
    setScreen("trade");
  }, [authLoading, user]);

  useEffect(() => {
    if (screen === "visitors" && ledgerAccountRow?.is_admin !== true) {
      setScreen("trade");
    }
  }, [screen, ledgerAccountRow?.is_admin]);

  /** Log logical app screen as path for visitor analytics (no PII). */
  useEffect(() => {
    const path = `/${screen}`;
    void fetch("/api/visitors/log", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }).catch(() => {});
  }, [screen]);

  useEffect(() => {
    if (screen === "auth" && user) setScreen("trade");
  }, [screen, user]);

  useEffect(() => {
    lastPopStateScreen.current = screen;
  }, [screen]);

  useEffect(() => {
    const onPop = () => {
      setScreen(lastPopStateScreen.current);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const [hlFeedStatus, setHlFeedStatus] = useState<"connecting" | "live" | "error">("connecting");
  const [hlFeedError, setHlFeedError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();

    const pull = () => {
      fetchHyperliquidMids(ac.signal)
        .then((r) => {
          if (r.marks === null) {
            setHlFeedError(
              "Could not load full Hyperliquid index data (main + commodity feeds). Try again in a moment or check your network.",
            );
            setHlFeedStatus("error");
            return;
          }
          setHlFeedError(null);
          dispatch({ type: "setMarks", marks: r.marks });
          setHlFeedStatus("live");
        })
        .catch((e: unknown) => {
          if (ac.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
          setHlFeedError("Network error while loading Hyperliquid prices. No placeholder prices are shown.");
          setHlFeedStatus("error");
        });
    };

    pull();
    const id = window.setInterval(pull, HL_POLL_INTERVAL_MS);
    return () => {
      ac.abort();
      window.clearInterval(id);
    };
  }, []);

  /** Auto-close when remaining margin at the current mark is exhausted (same math as manual close). Only while HL marks are live — avoids acting on stale prices if the feed errors. */
  useEffect(() => {
    if (hlFeedStatus !== "live") return;
    if (state.perpPositions.length === 0) return;
    const ids: string[] = [];
    for (const p of state.perpPositions) {
      const m = state.marks[p.symbol];
      if (isLiquidatedAtMark(p, m)) ids.push(p.id);
    }
    if (ids.length === 0) return;
    for (const positionId of ids) {
      dispatch({ type: "perpClose", positionId, reason: "liquidation" });
    }
  }, [hlFeedStatus, state.marks, state.perpPositions, dispatch]);

  return (
    <div
      className={screen === "landing" ? "app-shell app-shell--landing" : "app-shell"}
      style={screen === "landing" ? styles.shellLanding : styles.shell}
    >
      <header className="app-top-header" style={styles.topHeader}>
        <div className="app-header-top" style={styles.headerTop}>
          <div style={styles.logoRow}>
            <button
              type="button"
              style={styles.logoBtn}
              onClick={() => {
                setScreen("landing");
              }}
              aria-label="Home"
            >
              <img
                src="/logo-solve-quest.png"
                alt=""
                style={styles.logo}
                width={180}
                height={44}
              />
            </button>
            {demo ? (
              <span style={styles.demoBadge} title="Anonymous demo — state saved in this browser only">
                Demo
              </span>
            ) : null}
          </div>
          <div style={styles.navRight}>
            {user ? (
              <div style={styles.navAuthSignedIn}>
                <span style={styles.navUser} title={user.email}>
                  {user.email.length > 22 ? `${user.email.slice(0, 20)}…` : user.email}
                </span>
                {!demo && ledgerAccountRow?.account_active ? (
                  <span style={styles.activeBadge} title="At least one USDC deposit to your Solana address was credited">
                    Active
                  </span>
                ) : null}
                <button type="button" style={styles.navAuthBtn} onClick={() => void logout()}>
                  Sign out
                </button>
              </div>
            ) : (
              <button
                type="button"
                style={screen === "auth" ? styles.navAuthBtnOn : styles.navAuthBtn}
                onClick={() => setScreen("auth")}
              >
                Login / Register
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="app-body">
        <AppSidebar
          screen={screen}
          onNavigate={setScreen}
          showVisitors={ledgerAccountRow?.is_admin === true}
        />
        <main
          className="app-main"
          style={screen === "landing" ? styles.mainLanding : styles.main}
        >
          {screen !== "landing" && (
            <header style={styles.mainHeader}>
              <h1 className="app-page-title" style={styles.h1}>
                {SCREEN_HEADER[screen].title}
              </h1>
              {SCREEN_HEADER[screen].lead ? <p style={styles.lead}>{SCREEN_HEADER[screen].lead}</p> : null}
            </header>
          )}

          {screen === "landing" && (
            <LandingPage
              onStartNow={() => setScreen("trade")}
              onGoToPrize={() => setScreen("sellQusd")}
            />
          )}

          {screen === "auth" && (
            <AuthScreen onSuccess={() => setScreen("trade")} onContinueDemo={() => setScreen("trade")} />
          )}

          {screen === "quickstart" && (
            <QuickStartScreen
              onGoToPerps={() => setScreen("trade")}
              onGoToAccount={() => setScreen("account")}
            />
          )}

          {screen === "history" && <HistoryScreen />}

          {screen === "sellQusd" && (
            <QusdSellScreen
              qusdUnlocked={state.qusd.unlocked}
              solReceiveVerified={ledgerAccountRow?.sol_receive_verified_at != null}
              serverDepositAddress={ledgerAccountRow?.sol_receive_address?.trim() || null}
              onRefreshAccount={refreshAccountFromServer}
            />
          )}

          {screen === "leaderboard" && <LeaderboardScreen />}

          {screen === "trade" && (
            <PerpsTradeScreen
              marks={state.marks}
              positions={state.perpPositions}
              onOpen={(args) => dispatch({ type: "perpOpen", ...args })}
              onClose={(positionId) => dispatch({ type: "perpClose", positionId })}
              priceFeed={{
                status: hlFeedStatus,
                errorMessage: hlFeedError,
                intervalMs: HL_POLL_INTERVAL_MS,
                sourceLabel: "Hyperliquid",
              }}
              onNavigateToAccount={() => setScreen("account")}
              onGoToAuth={() => setScreen("auth")}
              bonusSetupComplete={
                !demo && Boolean(user) && ledgerAccountRow?.sol_receive_verified_at != null
              }
              isDemo={demo}
              qusdUnlocked={state.qusd.unlocked}
            />
          )}

          {screen === "account" && (
            <AccountScreen
              isDemo={demo}
              serverDepositAddress={ledgerAccountRow?.sol_receive_address?.trim() || null}
              solReceiveVerified={ledgerAccountRow?.sol_receive_verified_at != null}
              depositAddressError={ledgerHydrationError}
              qusdUnlocked={state.qusd.unlocked}
              onRefreshAccount={refreshAccountFromServer}
            />
          )}

          {screen === "visitors" && ledgerAccountRow?.is_admin === true ? <VisitorsScreen /> : null}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <SessionAuthProvider>
      <AppInner />
    </SessionAuthProvider>
  );
}

const styles: Record<string, CSSProperties> = {
  /** Layout: flex + height bound via index.css `.app-shell` + `#root` (only main scrolls). */
  shell: {
    boxSizing: "border-box",
  },
  shellLanding: {
    boxSizing: "border-box",
  },
  topHeader: {
    flexShrink: 0,
    borderBottom: "1px solid var(--border)",
    background: "#121214",
    padding: "0 var(--app-pad-x)",
  },
  main: {
    flex: 1,
    minWidth: 0,
    maxWidth: 1120,
    margin: "0 auto",
    width: "100%",
    padding: "var(--app-pad-y) var(--app-pad-x) var(--app-pad-bottom)",
    boxSizing: "border-box",
  },
  mainLanding: {
    flex: 1,
    minWidth: 0,
    maxWidth: 1200,
    margin: "0 auto",
    width: "100%",
    padding: "var(--app-pad-y) var(--app-pad-x) var(--app-pad-bottom)",
    boxSizing: "border-box",
  },
  mainHeader: {
    marginBottom: 24,
  },
  logoBtn: {
    background: "transparent",
    border: "none",
    padding: 0,
    cursor: "pointer",
    borderRadius: 8,
  },
  headerTop: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    minHeight: 56,
    padding: "10px 0",
  },
  logoRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
  },
  demoBadge: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--bg)",
    background: "color-mix(in srgb, var(--accent) 85%, #000)",
    borderRadius: 6,
    padding: "4px 10px",
    lineHeight: 1.2,
  },
  activeBadge: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--bg)",
    background: "color-mix(in srgb, var(--ok) 75%, #0a2e14)",
    borderRadius: 6,
    padding: "4px 10px",
    lineHeight: 1.2,
  },
  logo: {
    height: 44,
    width: "auto",
    maxWidth: "min(100%, 220px)",
    objectFit: "contain",
    display: "block",
  },
  navRight: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    marginLeft: "auto",
    justifyContent: "flex-end",
  },
  navAuthBtn: {
    marginLeft: 0,
    background: "transparent",
    border: "1px solid color-mix(in srgb, var(--accent) 40%, var(--border))",
    color: "var(--accent)",
    borderRadius: 8,
    padding: "8px 16px",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
  },
  navAuthBtnOn: {
    marginLeft: 0,
    background: "color-mix(in srgb, var(--accent) 18%, transparent)",
    border: "1px solid color-mix(in srgb, var(--accent) 55%, var(--border))",
    color: "var(--text)",
    borderRadius: 8,
    padding: "8px 16px",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
  },
  navAuthSignedIn: {
    marginLeft: 0,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    justifyContent: "flex-end",
  },
  navUser: {
    fontSize: 12,
    color: "var(--muted)",
    maxWidth: "min(42vw, 200px)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  h1: {
    fontSize: "clamp(1.2rem, 4.2vw, 1.75rem)",
    fontWeight: 700,
    margin: "0 0 8px",
    letterSpacing: "-0.02em",
  },
  h2: { fontSize: "1rem", fontWeight: 600, margin: "0 0 16px", color: "var(--muted)" },
  lead: { margin: 0, color: "var(--muted)", maxWidth: "min(62rem, 100%)" },
  muted: { color: "var(--muted)", fontSize: 14 },
  card: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
  },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 },
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 },
  dl: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: "8px 24px",
    margin: 0,
    fontSize: 14,
  },
  input: {
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--text)",
    padding: "8px 10px",
    minWidth: 120,
  },
  btn: {
    background: "rgba(255, 255, 255, 0.05)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    borderRadius: 8,
    padding: "8px 14px",
    fontWeight: 500,
  },
  btnGhost: {
    background: "transparent",
    border: "1px solid var(--border)",
    color: "var(--muted)",
    borderRadius: 8,
    padding: "8px 14px",
  },
  btnDanger: {
    background: "color-mix(in srgb, #dc2626 18%, var(--panel))",
    border: "1px solid #b91c1c",
    color: "#fecaca",
    borderRadius: 8,
    padding: "8px 14px",
    fontWeight: 500,
  },
  btnWarn: {
    background: "color-mix(in srgb, var(--warn) 12%, var(--panel))",
    border: "1px solid color-mix(in srgb, var(--warn) 35%, var(--border))",
    color: "#fde68a",
    borderRadius: 8,
    padding: "8px 14px",
    fontWeight: 500,
  },
  hint: { margin: "8px 0 0", fontSize: 12, color: "var(--muted)" },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 14,
  },
  ul: { margin: 0, paddingLeft: 20, color: "var(--muted)", fontSize: 14 },
  log: {
    maxHeight: 280,
    overflow: "auto",
    fontFamily: "var(--mono)",
  },
};
