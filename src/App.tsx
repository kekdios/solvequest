import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { SessionAuthProvider, useAuthMode, isDemoMode, useSessionAuth } from "./auth/sessionAuth";
import { getDefaultDemoAppState, loadDemoAppState, saveDemoAppState } from "./lib/demoPersistence";
import {
  buildAccountStatePutBody,
  putAccountState,
  putSolReceiveAddress,
} from "./lib/accountSync";
import { getOrCreateAccountReceiveWallet } from "./lib/accountReceiveAddresses";
import type { DemoAppState, DemoLogEntry, PerpCloseSyncEvent } from "./lib/demoSessionTypes";
import { INITIAL_SESSION_WARN_FLAGS } from "./lib/demoSessionTypes";
import { syncEquity } from "./engine/accountCore";
import { fetchHyperliquidMids, HL_POLL_INTERVAL_MS } from "./engine/hyperliquid";
import { LOCKED_QUSD_COOLDOWN_MS, QUSD_INTEREST_PER_MINUTE_FACTOR } from "./engine/qusdVault";
import {
  computeUnrealizedPnl,
  INITIAL_MARKS,
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
import AuthScreen from "./screens/AuthScreen";
import AppSidebar, { type AppScreen } from "./components/AppSidebar";
import {
  getAdminPublicOrigin,
  getMainSitePublicOrigin,
  isAdminSubdomainHost,
} from "./lib/appHost";

const AdminScreen = lazy(() => import("./screens/AdminScreen"));

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
  | { type: "perpClose"; positionId: string }
  | { type: "lockQusd"; amount: number }
  | { type: "unlockQusd"; amount: number }
  | { type: "qusdInterestMinute" }
  | { type: "hydrateFromAccountRow"; row: PersistedAccountRow; keepLocalPendingPerpCloses?: boolean }
  | { type: "replaceAll"; state: DemoAppState }
  | { type: "perpClosesSynced" };

function pushLog(log: DemoLogEntry[], entry: Omit<DemoLogEntry, "id" | "t">): DemoLogEntry[] {
  return [
    ...log,
    { ...entry, id: crypto.randomUUID(), t: Date.now() },
  ].slice(-80);
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
    case "lockQusd": {
      const amount = action.amount;
      if (amount <= 0 || amount > state.qusd.unlocked + 1e-9) return state;
      const t = Date.now();
      return {
        ...state,
        vaultActivityAt: t,
        qusd: {
          unlocked: state.qusd.unlocked - amount,
          locked: state.qusd.locked + amount,
        },
      };
    }
    case "unlockQusd": {
      const amount = action.amount;
      if (amount <= 0 || amount > state.qusd.locked + 1e-9) return state;
      if (
        state.vaultActivityAt !== null &&
        Date.now() < state.vaultActivityAt + LOCKED_QUSD_COOLDOWN_MS
      ) {
        return state;
      }
      const t = Date.now();
      return {
        ...state,
        vaultActivityAt: t,
        qusd: {
          unlocked: state.qusd.unlocked + amount,
          locked: state.qusd.locked - amount,
        },
      };
    }
    case "qusdInterestMinute": {
      const { locked } = state.qusd;
      if (locked <= 1e-12) return state;
      const interest = locked * QUSD_INTEREST_PER_MINUTE_FACTOR;
      return {
        ...state,
        qusd: { ...state.qusd, locked: locked + interest },
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
        qusd: { ...state.qusd, unlocked: state.qusd.unlocked - tokens },
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
      const positions = action.row.open_perp_positions ?? [];
      const marginLocked = positions.reduce((s, p) => s + p.marginUsdc, 0);
      const baseUnlocked = slice.qusd.unlocked;
      return {
        ...state,
        ...slice,
        qusd: {
          unlocked: Math.max(0, baseUnlocked - marginLocked),
          locked: slice.qusd.locked,
        },
        perpPositions: positions,
        marks: { ...INITIAL_MARKS },
        sessionWarnFlags: INITIAL_SESSION_WARN_FLAGS,
        vaultActivityAt: slice.vaultActivityAt,
        pendingPerpCloses: action.keepLocalPendingPerpCloses ? (state.pendingPerpCloses ?? []) : [],
        log: pushLog([], {
          kind: "info",
          message: "Loaded account balances from the server database.",
        }),
      };
    }
    case "replaceAll":
      return action.state;
    case "perpClosesSynced":
      return { ...state, pendingPerpCloses: [] };
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
      const msg =
        upl >= 0
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
        qusd: { ...state.qusd, unlocked: nextUnlocked },
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
    lead: "A short path from here to your first perpetual trade.",
  },
  trade: {
    title: "Perpetuals",
    lead: "",
  },
  history: {
    title: "History",
    lead: "Closed perpetual trades (newest first).",
  },
  account: {
    title: "Account",
    lead: "",
  },
  auth: {
    title: "Login / Register",
    lead: "Email code — register or sign in. Optional 7-day remember-me.",
  },
  admin: {
    title: "Admin",
    lead: "Solana wallet sign-in for operators.",
  },
};

function AppInner() {
  const authMode = useAuthMode();
  const { user, logout, authLoading } = useSessionAuth();
  const demo = isDemoMode(authMode);

  const [ledgerAccountRow, setLedgerAccountRow] = useState<PersistedAccountRow | null>(null);

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

  /** Registered: persist full trading + vault state to SQLite (debounced). */
  useEffect(() => {
    if (demo || !user?.email || authLoading || !ledgerAccountRow) return;
    if (accountSyncTimer.current) clearTimeout(accountSyncTimer.current);
    accountSyncTimer.current = setTimeout(() => {
      void (async () => {
        const body = buildAccountStatePutBody(stateRef.current, syncVersionRef.current);
        const result = await putAccountState(body);
        accountSyncTimer.current = null;
        if (result.ok) {
          syncVersionRef.current = result.sync_version;
          dispatch({ type: "perpClosesSynced" });
          return;
        }
        if (!("conflict" in result) || !result.conflict) return;
        syncVersionRef.current = result.sync_version;
        const r = await fetch("/api/account/me", { credentials: "include" });
        if (!r.ok) return;
        const data = (await r.json()) as PersistedAccountRow;
        setLedgerAccountRow(data);
        dispatch({ type: "hydrateFromAccountRow", row: data, keepLocalPendingPerpCloses: true });
        syncVersionRef.current = Number(data.sync_version ?? 0);
        const retry = await putAccountState(
          buildAccountStatePutBody(stateRef.current, syncVersionRef.current),
        );
        if (retry.ok) {
          syncVersionRef.current = retry.sync_version;
          dispatch({ type: "perpClosesSynced" });
        }
      })();
    }, 450);
    return () => {
      if (accountSyncTimer.current) clearTimeout(accountSyncTimer.current);
    };
  }, [demo, user?.email, authLoading, state, ledgerAccountRow]);

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
        const result = await putAccountState(
          buildAccountStatePutBody(stateRef.current, syncVersionRef.current),
        );
        if (result.ok) {
          syncVersionRef.current = result.sync_version;
          dispatch({ type: "perpClosesSynced" });
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
    dispatch({ type: "replaceAll", state: loadDemoAppState() ?? getDefaultDemoAppState() });
  }, [authLoading, user]);

  /** Registered user: load `accounts` row from SQLite (GET /api/account/me). */
  useEffect(() => {
    if (authLoading || demo || !user) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/account/me", { credentials: "include" });
        if (!r.ok) {
          if (!cancelled) setLedgerAccountRow(null);
          return;
        }
        const data = (await r.json()) as PersistedAccountRow;
        if (cancelled) return;
        setLedgerAccountRow(data);
        syncVersionRef.current = Number(data.sync_version ?? 0);
        dispatch({ type: "hydrateFromAccountRow", row: data });
      } catch {
        if (!cancelled) setLedgerAccountRow(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, demo, user?.email]);

  /** Sync custodial Solana receive pubkey to SQLite so the server deposit worker can credit QUSD. */
  useEffect(() => {
    if (demo || !user?.email || !ledgerAccountRow || authLoading) return;
    let cancelled = false;
    void (async () => {
      try {
        const w = getOrCreateAccountReceiveWallet();
        if (ledgerAccountRow.sol_receive_address === w.solAddress) return;
        const ok = await putSolReceiveAddress(w.solAddress);
        if (!ok || cancelled) return;
        const r = await fetch("/api/account/me", { credentials: "include" });
        if (!r.ok || cancelled) return;
        const data = (await r.json()) as PersistedAccountRow;
        setLedgerAccountRow(data);
        syncVersionRef.current = Number(data.sync_version ?? 0);
        dispatch({ type: "hydrateFromAccountRow", row: data, keepLocalPendingPerpCloses: true });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [demo, user?.email, authLoading, ledgerAccountRow?.id, ledgerAccountRow?.sol_receive_address]);

  /** Pick up on-chain deposit credits (server bumps sync_version). */
  useEffect(() => {
    if (demo || !user?.email || authLoading || !ledgerAccountRow) return;
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const r = await fetch("/api/account/me", { credentials: "include" });
          if (!r.ok) return;
          const data = (await r.json()) as PersistedAccountRow;
          const sv = Number(data.sync_version ?? 0);
          if (sv <= syncVersionRef.current) return;
          setLedgerAccountRow(data);
          dispatch({ type: "hydrateFromAccountRow", row: data, keepLocalPendingPerpCloses: true });
          syncVersionRef.current = sv;
        } catch {
          /* ignore */
        }
      })();
    }, 25_000);
    return () => window.clearInterval(id);
  }, [demo, user?.email, authLoading, ledgerAccountRow?.id]);

  const lastNonAdminScreen = useRef<AppScreen>("landing");

  const [screen, setScreen] = useState<AppScreen>(() => {
    if (typeof window === "undefined") return "landing";
    if (isAdminSubdomainHost()) return "admin";
    return "landing";
  });

  /** Main site: /admin URL → admin subdomain only. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isAdminSubdomainHost()) return;
    if (window.location.pathname.startsWith("/admin")) {
      window.location.replace(
        `${getAdminPublicOrigin()}${window.location.pathname}${window.location.search}${window.location.hash}`,
      );
    }
  }, []);

  /** Main site must never keep Admin screen (menu removed; deep links redirect). */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isAdminSubdomainHost()) return;
    if (screen === "admin") {
      window.location.replace(getAdminPublicOrigin());
    }
  }, [screen]);

  /** Admin subdomain: only Admin (or Auth). */
  useEffect(() => {
    if (!isAdminSubdomainHost()) return;
    if (screen === "auth") return;
    if (screen !== "admin") setScreen("admin");
  }, [screen]);

  useEffect(() => {
    if (screen === "auth" && user) setScreen(isAdminSubdomainHost() ? "admin" : "trade");
  }, [screen, user]);

  useEffect(() => {
    if (screen !== "admin") lastNonAdminScreen.current = screen;
  }, [screen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isAdminSubdomainHost()) {
      window.history.replaceState({}, "", "/");
      return;
    }
    const pathAdmin = window.location.pathname.startsWith("/admin");
    if (screen === "admin" && !pathAdmin) {
      window.history.replaceState({}, "", "/admin");
    } else if (screen !== "admin" && pathAdmin) {
      window.history.replaceState({}, "", "/");
    }
  }, [screen]);

  useEffect(() => {
    const onPop = () => {
      if (isAdminSubdomainHost()) {
        setScreen("admin");
        return;
      }
      if (window.location.pathname.startsWith("/admin")) {
        window.location.href = getAdminPublicOrigin();
        return;
      }
      setScreen(lastNonAdminScreen.current);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /** 1% / day on locked QUSD; demo: credit every minute in-browser. Registered: server compounds on GET /api/account/me. */
  useEffect(() => {
    if (!demo) return;
    const id = window.setInterval(() => {
      dispatch({ type: "qusdInterestMinute" });
    }, 60_000);
    return () => window.clearInterval(id);
  }, [demo]);

  const lockQusd = useCallback((amount: number) => {
    dispatch({ type: "lockQusd", amount });
  }, []);

  const unlockQusd = useCallback((amount: number) => {
    dispatch({ type: "unlockQusd", amount });
  }, []);

  const [hlFeedStatus, setHlFeedStatus] = useState<"connecting" | "live" | "partial">("connecting");

  useEffect(() => {
    if (typeof window !== "undefined" && isAdminSubdomainHost()) return;

    const ac = new AbortController();

    const pull = () => {
      fetchHyperliquidMids(ac.signal)
        .then((r) => {
          dispatch({ type: "setMarks", marks: r.marks });
          setHlFeedStatus(r.allLive ? "live" : "partial");
        })
        .catch((e: unknown) => {
          if (ac.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
          dispatch({ type: "setMarks", marks: { ...INITIAL_MARKS } });
          setHlFeedStatus("partial");
        });
    };

    pull();
    const id = window.setInterval(pull, HL_POLL_INTERVAL_MS);
    return () => {
      ac.abort();
      window.clearInterval(id);
    };
  }, []);

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
                if (isAdminSubdomainHost()) {
                  window.location.href = getMainSitePublicOrigin();
                } else {
                  setScreen("landing");
                }
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
            {demo && !isAdminSubdomainHost() ? (
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
          variant={isAdminSubdomainHost() ? "adminSubdomain" : "mainApp"}
          mainSiteOrigin={getMainSitePublicOrigin()}
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

          {screen === "landing" && <LandingPage onStartNow={() => setScreen("trade")} />}

          {screen === "admin" && (
            <Suspense fallback={<p style={styles.muted}>Loading admin…</p>}>
              <AdminScreen
                onNavigateHome={() => {
                  window.location.href = getMainSitePublicOrigin();
                }}
                onCustodialUsdcCredited={() => {
                  /* USDC → QUSD credits run server-side (deposit worker); avoid double-counting. */
                }}
              />
            </Suspense>
          )}

          {screen === "auth" && (
            <AuthScreen
              onSuccess={() => setScreen(isAdminSubdomainHost() ? "admin" : "trade")}
              onContinueDemo={() => setScreen(isAdminSubdomainHost() ? "admin" : "trade")}
            />
          )}

          {screen === "quickstart" && (
            <QuickStartScreen
              onGoToPerps={() => setScreen("trade")}
              onGoToAccount={() => setScreen("account")}
            />
          )}

          {screen === "history" && <HistoryScreen />}

          {screen === "trade" && (
            <PerpsTradeScreen
              marks={state.marks}
              positions={state.perpPositions}
              onOpen={(args) => dispatch({ type: "perpOpen", ...args })}
              onClose={(positionId) => dispatch({ type: "perpClose", positionId })}
              priceFeed={{
                status: hlFeedStatus,
                intervalMs: HL_POLL_INTERVAL_MS,
                sourceLabel: "Hyperliquid",
              }}
              onNavigateToAccount={() => setScreen("account")}
              qusdUnlocked={state.qusd.unlocked}
              qusdLocked={state.qusd.locked}
            />
          )}

          {screen === "account" && (
            <AccountScreen
              isDemo={demo}
              ledgerAccountRow={ledgerAccountRow}
              qusdUnlocked={state.qusd.unlocked}
              qusdLocked={state.qusd.locked}
              onLockQusd={lockQusd}
              onUnlockQusd={unlockQusd}
              vaultActivityAt={state.vaultActivityAt}
            />
          )}
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
