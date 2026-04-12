import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { SessionAuthProvider, useAuthMode, isDemoMode, useSessionAuth } from "./auth/sessionAuth";
import { getDefaultDemoAppState, loadDemoAppState, saveDemoAppState } from "./lib/demoPersistence";
import type { DemoAppState, DemoLogEntry } from "./lib/demoSessionTypes";
import {
  createAccount,
  handleLoss,
  canWithdraw,
  syncEquity,
  purchaseCoverageExtension,
} from "./engine/insurance";
import { INITIAL_COVERAGE_WARN_FLAGS, nextCoverageWarnings } from "./engine/coverageWarnings";
import { forceCloseAllPerps } from "./engine/perpsForceClose";
import {
  applyTierToAccount,
  DEFAULT_INSURANCE_TIER_ID,
  getInsuranceTier,
  type InsuranceTierId,
} from "./engine/insuranceTiers";
import { fetchHyperliquidMids, HL_POLL_INTERVAL_MS } from "./engine/hyperliquid";
import {
  BONUS_REPAYMENT_USDC,
  LOCKED_QUSD_COOLDOWN_MS,
  QUSD_INTEREST_PER_MINUTE_FACTOR,
  QUSD_PER_USD,
} from "./engine/qusdVault";
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
import InsuranceScreen from "./screens/InsuranceScreen";
import AccountScreen from "./screens/AccountScreen";
import QuickStartScreen from "./screens/QuickStartScreen";
import AuthScreen from "./screens/AuthScreen";

const AdminScreen = lazy(() => import("./screens/AdminScreen"));

type State = DemoAppState;

type Action =
  | { type: "reset"; deposit: number }
  | { type: "deposit"; amount: number }
  | { type: "loss"; amount: number }
  | { type: "withdrawTry" }
  | { type: "setMarks"; marks: Record<PerpSymbol, number> }
  | { type: "purchaseCoveragePremium" }
  | {
      type: "perpOpen";
      symbol: PerpSymbol;
      side: "long" | "short";
      notionalUsdc: number;
      leverage: number;
    }
  | { type: "perpClose"; positionId: string }
  | { type: "setInsuranceTier"; tierId: InsuranceTierId }
  | { type: "lockQusd"; amount: number }
  | { type: "unlockQusd"; amount: number }
  | { type: "qusdInterestMinute" }
  | { type: "repayBonusUsdc"; amount: number }
  | { type: "unlockedTopUpUsdc"; usdc: number }
  | { type: "unlockedWithdrawUsdc"; usdc: number }
  | { type: "hydrateFromAccountRow"; row: PersistedAccountRow }
  | { type: "replaceAll"; state: DemoAppState };

function pushLog(log: DemoLogEntry[], entry: Omit<DemoLogEntry, "id" | "t">): DemoLogEntry[] {
  return [
    ...log,
    { ...entry, id: crypto.randomUUID(), t: Date.now() },
  ].slice(-80);
}

function reducer(state: State, action: Action): State {
  const { account, log } = state;

  switch (action.type) {
    case "reset":
      return {
        ...state,
        insuranceTierId: DEFAULT_INSURANCE_TIER_ID,
        account: applyTierToAccount(createAccount("demo", action.deposit), DEFAULT_INSURANCE_TIER_ID),
        perpPositions: [],
        marks: { ...INITIAL_MARKS },
        coverageWarnFlags: INITIAL_COVERAGE_WARN_FLAGS,
        accumulatedLossesQusd: 0,
        qusd: { unlocked: 10_000, locked: 0 },
        bonusRepaidUsdc: 0,
        vaultActivityAt: null,
        log: pushLog(log, {
          kind: "info",
          message: `New session: ${action.deposit} USDC · Smart Pool Insurance Tier ${DEFAULT_INSURANCE_TIER_ID}`,
        }),
      };
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
    case "loss": {
      if (action.amount <= 0) return state;
      const { account: next, breakdown } = handleLoss(account, action.amount);
      const lines = [
        `Loss ${breakdown.loss} USDC`,
        `Pool covered ${breakdown.poolCovered.toFixed(2)} QUSD`,
        `You paid ${breakdown.userPays.toFixed(2)} USDC`,
      ];
      return {
        ...state,
        account: next,
        log: pushLog(log, { kind: "loss", message: lines.join(" · ") }),
      };
    }
    case "purchaseCoveragePremium": {
      const { account: next, ok } = purchaseCoverageExtension(account);
      if (!ok) {
        return {
          ...state,
          log: pushLog(log, { kind: "block", message: "Need at least 1 USDC to buy +200 QUSD loss cover." }),
        };
      }
      return {
        ...state,
        account: next,
        coverageWarnFlags: INITIAL_COVERAGE_WARN_FLAGS,
        log: pushLog(log, {
          kind: "premium",
          message: `Premium: paid 1 USDC · max insured loss cover +200 QUSD (now ${next.plan.coverageLimit.toLocaleString()} QUSD cap)`,
        }),
      };
    }
    case "setInsuranceTier": {
      if (state.perpPositions.length > 0) return state;
      const { tierId } = action;
      const t = getInsuranceTier(tierId);
      return {
        ...state,
        insuranceTierId: tierId,
        coverageWarnFlags: INITIAL_COVERAGE_WARN_FLAGS,
        account: applyTierToAccount(account, tierId),
        log: pushLog(log, {
          kind: "info",
          message: `Smart Pool Insurance: Tier ${tierId} — ${(t.winningsPct * 100).toFixed(0)}% of winnings to pool · ${t.maxLossCoveredQusd.toLocaleString()} QUSD max insured losses`,
        }),
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
    case "repayBonusUsdc": {
      const maxOwed = BONUS_REPAYMENT_USDC - state.bonusRepaidUsdc;
      if (maxOwed <= 0) return state;
      const pay = Math.min(action.amount, maxOwed, state.account.balance);
      if (pay <= 0) return state;
      const nextBal = state.account.balance - pay;
      return {
        ...state,
        bonusRepaidUsdc: state.bonusRepaidUsdc + pay,
        account: syncEquity({ ...state.account, balance: nextBal }),
        log: pushLog(log, {
          kind: "info",
          message: `Bonus repayment +${pay.toFixed(2)} USDC (${(state.bonusRepaidUsdc + pay).toFixed(2)} / ${BONUS_REPAYMENT_USDC} toward unlocking Send)`,
        }),
      };
    }
    case "unlockedTopUpUsdc": {
      const u = action.usdc;
      if (u <= 0 || u > state.account.balance + 1e-9) return state;
      const qusdIn = u * QUSD_PER_USD;
      const nextBal = state.account.balance - u;
      return {
        ...state,
        account: syncEquity({ ...state.account, balance: nextBal }),
        qusd: { ...state.qusd, unlocked: state.qusd.unlocked + qusdIn },
        log: pushLog(log, {
          kind: "info",
          message: `Top up +${u.toFixed(4)} USDC → +${qusdIn.toFixed(2)} QUSD unlocked`,
        }),
      };
    }
    case "unlockedWithdrawUsdc": {
      const u = action.usdc;
      if (u <= 0) return state;
      const qusdOut = u * QUSD_PER_USD;
      if (qusdOut > state.qusd.unlocked + 1e-9) return state;
      const nextBal = state.account.balance + u;
      return {
        ...state,
        account: syncEquity({ ...state.account, balance: nextBal }),
        qusd: { ...state.qusd, unlocked: state.qusd.unlocked - qusdOut },
        log: pushLog(log, {
          kind: "info",
          message: `Withdraw −${qusdOut.toFixed(2)} QUSD → +${u.toFixed(4)} USDC wallet`,
        }),
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
    case "withdrawTry": {
      const w = canWithdraw(account);
      if (w.ok) {
        return {
          ...state,
          log: pushLog(log, { kind: "info", message: "Withdrawal allowed — policy conditions satisfied" }),
        };
      }
      return {
        ...state,
        log: pushLog(log, {
          kind: "block",
          message: `${w.reason}${w.topUpNeeded ? ` · Top-up needed: ${w.topUpNeeded.toFixed(2)} USDC` : ""}`,
        }),
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
      return {
        ...state,
        ...slice,
        perpPositions: [],
        marks: { ...INITIAL_MARKS },
        coverageWarnFlags: INITIAL_COVERAGE_WARN_FLAGS,
        bonusRepaidUsdc: 0,
        vaultActivityAt: null,
        log: pushLog([], {
          kind: "info",
          message: "Loaded account balances from the server database.",
        }),
      };
    }
    case "replaceAll":
      return action.state;
    case "perpClose": {
      const pos = state.perpPositions.find((p) => p.id === action.positionId);
      if (!pos) return state;
      const mark = state.marks[pos.symbol];
      const upl = computeUnrealizedPnl(pos, mark);
      const margin = pos.marginUsdc;
      const nextPositions = state.perpPositions.filter((p) => p.id !== action.positionId);

      if (upl >= 0) {
        const tier = getInsuranceTier(state.insuranceTierId);
        const poolContribution = upl * tier.winningsPct;
        const creditQusd = margin + upl - poolContribution;
        const nextAccount = syncEquity({
          ...account,
          premiumAccrued: account.premiumAccrued + poolContribution,
        });
        return {
          ...state,
          account: nextAccount,
          qusd: { ...state.qusd, unlocked: state.qusd.unlocked + creditQusd },
          perpPositions: nextPositions,
          log: pushLog(log, {
            kind: "info",
            message: `Closed ${pos.symbol} ${pos.side} · Realized +${upl.toFixed(2)} QUSD · Pool contribution ${poolContribution.toFixed(2)} QUSD (${(tier.winningsPct * 100).toFixed(0)}% of win, Tier ${tier.id})`,
          }),
        };
      }

      const loss = Math.abs(upl);
      const remainingCov = Math.max(0, account.plan.coverageLimit - account.coverageUsed);
      const poolCovered = Math.min(loss, remainingCov);
      const userPays = loss - poolCovered;

      let afterLoss = syncEquity({
        ...account,
        coverageUsed: account.coverageUsed + poolCovered,
        coveredLosses: account.coveredLosses + poolCovered,
      });

      let qusdUnlocked = state.qusd.unlocked + margin - userPays;
      if (qusdUnlocked < 0) qusdUnlocked = 0;

      const breakdown = { loss, poolCovered, userPays };

      let wf = state.coverageWarnFlags;
      let nextLog = log;
      const warn = nextCoverageWarnings(
        afterLoss.coverageUsed,
        afterLoss.plan.coverageLimit,
        wf,
      );
      wf = warn.flags;
      for (const m of warn.messages) {
        nextLog = pushLog(nextLog, { kind: "coverage", message: m });
      }

      let acc = afterLoss;
      let positionsAfter = nextPositions;
      let forcedLossAccum = 0;
      let qusdAfter = { ...state.qusd, unlocked: qusdUnlocked };

      if (acc.coverageUsed >= acc.plan.coverageLimit - 1e-9 && positionsAfter.length > 0) {
        const fc = forceCloseAllPerps({
          account: acc,
          qusd: qusdAfter,
          positions: positionsAfter,
          marks: state.marks,
          insuranceTierId: state.insuranceTierId,
        });
        acc = fc.account;
        qusdAfter = fc.qusd;
        forcedLossAccum = fc.lossesQusd;
        positionsAfter = [];
        nextLog = pushLog(nextLog, {
          kind: "coverage",
          message: "Max insured loss cover reached — all remaining positions were closed.",
        });
      }

      const extra =
        breakdown.userPays > 0
          ? ` · You paid ${breakdown.userPays.toFixed(2)} QUSD (above pool cover)`
          : "";

      const lossThisClose = loss;
      const accumulatedLossesQusd = state.accumulatedLossesQusd + lossThisClose + forcedLossAccum;

      return {
        ...state,
        account: acc,
        qusd: qusdAfter,
        perpPositions: positionsAfter,
        coverageWarnFlags: wf,
        accumulatedLossesQusd,
        log: pushLog(nextLog, {
          kind: "loss",
          message: `Pool covered ${breakdown.poolCovered.toFixed(2)} QUSD · ${breakdown.userPays.toFixed(2)} QUSD from allocation${extra} · Closed ${pos.symbol}`,
        }),
      };
    }
    default:
      return state;
  }
}

type AppScreen = "landing" | "quickstart" | "trade" | "insurance" | "account" | "auth" | "admin";

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
    insurance: {
    title: "Insurance",
    lead: "Pick a tier for max insured losses and win skim. Losses draw from your cap; at 100%, all positions close. Pay 1 USDC for +200 QUSD cap.",
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

  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!demo) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      saveDemoAppState(state);
      persistTimer.current = null;
    }, 400);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [demo, state]);

  useEffect(() => {
    if (!demo) return;
    const flush = () => saveDemoAppState(stateRef.current);
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [demo]);

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
        dispatch({ type: "hydrateFromAccountRow", row: data });
      } catch {
        if (!cancelled) setLedgerAccountRow(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, demo, user?.email]);

  const lastNonAdminScreen = useRef<AppScreen>("landing");

  const [screen, setScreen] = useState<AppScreen>(() => {
    if (typeof window !== "undefined" && window.location.pathname.startsWith("/admin")) return "admin";
    return "landing";
  });

  useEffect(() => {
    if (screen === "auth" && user) setScreen("trade");
  }, [screen, user]);

  useEffect(() => {
    if (screen !== "admin") lastNonAdminScreen.current = screen;
  }, [screen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const pathAdmin = window.location.pathname.startsWith("/admin");
    if (screen === "admin" && !pathAdmin) {
      window.history.replaceState({}, "", "/admin");
    } else if (screen !== "admin" && pathAdmin) {
      window.history.replaceState({}, "", "/");
    }
  }, [screen]);

  useEffect(() => {
    const onPop = () => {
      if (window.location.pathname.startsWith("/admin")) {
        setScreen("admin");
      } else {
        setScreen(lastNonAdminScreen.current);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /** 1% / day on locked QUSD; credited to locked balance every minute. */
  useEffect(() => {
    const id = window.setInterval(() => {
      dispatch({ type: "qusdInterestMinute" });
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const lockQusd = useCallback((amount: number) => {
    dispatch({ type: "lockQusd", amount });
  }, []);

  const unlockQusd = useCallback((amount: number) => {
    dispatch({ type: "unlockQusd", amount });
  }, []);

  const [depositStr, setDepositStr] = useState("0");
  const [addStr, setAddStr] = useState("100");

  const [hlFeedStatus, setHlFeedStatus] = useState<"connecting" | "live" | "partial">("connecting");

  useEffect(() => {
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

  const w = useMemo(() => canWithdraw(state.account), [state.account]);

  const fmt = useCallback((n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 }), []);

  const logPreview = useMemo(() => [...state.log].slice(-18).reverse(), [state.log]);

  const pageStyle =
    screen === "landing" ||
    screen === "quickstart" ||
    screen === "trade" ||
    screen === "insurance" ||
    screen === "account" ||
    screen === "auth" ||
    screen === "admin"
      ? styles.pageWide
      : styles.page;

  return (
    <div
      className={screen === "landing" ? "app-shell app-shell--landing" : "app-shell"}
      style={screen === "landing" ? styles.pageLanding : pageStyle}
    >
      <header style={screen === "landing" ? { ...styles.header, marginBottom: 0 } : styles.header}>
        <div className="app-header-top" style={styles.headerTop}>
          <div style={styles.logoRow}>
            <button type="button" style={styles.logoBtn} onClick={() => setScreen("landing")} aria-label="Home">
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
          <nav className="app-nav" style={styles.nav} aria-label="Primary">
            <div style={styles.navMain}>
              <button
                type="button"
                className={`app-nav-tab${screen === "landing" ? " app-nav-tab--on" : ""}`}
                style={styles.navBtn}
                onClick={() => setScreen("landing")}
              >
                Home
              </button>
              <button
                type="button"
                className={`app-nav-tab${screen === "quickstart" ? " app-nav-tab--on" : ""}`}
                style={styles.navBtn}
                onClick={() => setScreen("quickstart")}
              >
                Quick Start
              </button>
              <button
                type="button"
                className={`app-nav-tab${screen === "trade" ? " app-nav-tab--on" : ""}`}
                style={styles.navBtn}
                onClick={() => setScreen("trade")}
              >
                Perpetuals
              </button>
              <button
                type="button"
                className={`app-nav-tab${screen === "insurance" ? " app-nav-tab--on" : ""}`}
                style={styles.navBtn}
                onClick={() => setScreen("insurance")}
              >
                Insurance
              </button>
              <button
                type="button"
                className={`app-nav-tab${screen === "account" ? " app-nav-tab--on" : ""}`}
                style={styles.navBtn}
                onClick={() => setScreen("account")}
              >
                Account
              </button>
              <button
                type="button"
                className={`app-nav-tab${screen === "admin" ? " app-nav-tab--on" : ""}`}
                style={styles.navBtn}
                onClick={() => setScreen("admin")}
              >
                Admin
              </button>
            </div>
            <div style={styles.navRight}>
              {user ? (
                <div style={styles.navAuthSignedIn}>
                  <span style={styles.navUser} title={user.email}>
                    {user.email.length > 22 ? `${user.email.slice(0, 20)}…` : user.email}
                  </span>
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
          </nav>
        </div>
        {screen !== "landing" && (
          <>
            <h1 className="app-page-title" style={styles.h1}>
              {SCREEN_HEADER[screen].title}
            </h1>
            {SCREEN_HEADER[screen].lead ? (
              <p style={styles.lead}>{SCREEN_HEADER[screen].lead}</p>
            ) : null}
          </>
        )}
      </header>

      {screen === "landing" && <LandingPage onStartNow={() => setScreen("trade")} />}

      {screen === "admin" && (
        <Suspense fallback={<p style={styles.muted}>Loading admin…</p>}>
          <AdminScreen
            onNavigateHome={() => setScreen("landing")}
            onCustodialUsdcCredited={(amount) => dispatch({ type: "deposit", amount })}
          />
        </Suspense>
      )}

      {screen === "auth" && (
        <AuthScreen onSuccess={() => setScreen("trade")} onContinueDemo={() => setScreen("trade")} />
      )}

      {screen === "quickstart" && (
        <QuickStartScreen
          onGoToPerps={() => setScreen("trade")}
          onGoToAccount={() => setScreen("account")}
          onGoToInsurance={() => setScreen("insurance")}
        />
      )}

      {screen === "trade" && (
        <PerpsTradeScreen
          marks={state.marks}
          positions={state.perpPositions}
          onOpen={(args) => dispatch({ type: "perpOpen", ...args })}
          onClose={(positionId) => dispatch({ type: "perpClose", positionId })}
          insuranceTierId={state.insuranceTierId}
          insurance={{
            coveredLosses: state.account.coveredLosses,
            premiumAccrued: state.account.premiumAccrued,
            coverageUsed: state.account.coverageUsed,
            coverageLimit: state.account.plan.coverageLimit,
          }}
          priceFeed={{
            status: hlFeedStatus,
            intervalMs: HL_POLL_INTERVAL_MS,
            sourceLabel: "Hyperliquid",
          }}
          onNavigateToInsurance={() => setScreen("insurance")}
          onNavigateToAccount={() => setScreen("account")}
          qusdUnlocked={state.qusd.unlocked}
          qusdLocked={state.qusd.locked}
        />
      )}

      {screen === "insurance" && (
        <InsuranceScreen
          account={state.account}
          fmt={fmt}
          insuranceTierId={state.insuranceTierId}
          canChangeInsuranceTier={state.perpPositions.length === 0}
          onSelectInsuranceTier={(tierId) => dispatch({ type: "setInsuranceTier", tierId })}
          depositStr={depositStr}
          setDepositStr={setDepositStr}
          addStr={addStr}
          setAddStr={setAddStr}
          onReset={() => dispatch({ type: "reset", deposit: Number(depositStr) || 0 })}
          onDeposit={() => dispatch({ type: "deposit", amount: Number(addStr) || 0 })}
          onPurchaseCoveragePremium={() => dispatch({ type: "purchaseCoveragePremium" })}
          canPurchaseCoveragePremium={state.account.balance >= 1}
          withdrawOk={w.ok}
          onWithdrawTry={() => dispatch({ type: "withdrawTry" })}
          logPreview={logPreview}
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
          bonusRepaidUsdc={state.bonusRepaidUsdc}
          usdcBalance={state.account.balance}
          sendUnlocked={state.bonusRepaidUsdc >= BONUS_REPAYMENT_USDC}
          vaultActivityAt={state.vaultActivityAt}
          onRepayBonusUsdc={(amount) => dispatch({ type: "repayBonusUsdc", amount })}
          onUnlockedTopUpUsdc={(usdc) => dispatch({ type: "unlockedTopUpUsdc", usdc })}
          onUnlockedWithdrawUsdc={(usdc) => dispatch({ type: "unlockedWithdrawUsdc", usdc })}
        />
      )}

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
  page: {
    maxWidth: 920,
    margin: "0 auto",
    padding: "var(--app-pad-y) var(--app-pad-x) var(--app-pad-bottom)",
  },
  pageWide: {
    maxWidth: 1120,
    margin: "0 auto",
    padding: "var(--app-pad-y) var(--app-pad-x) var(--app-pad-bottom)",
  },
  pageLanding: {
    maxWidth: 1200,
    margin: "0 auto",
    padding: "var(--app-pad-y) var(--app-pad-x) var(--app-pad-bottom)",
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
    marginBottom: 16,
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
  logo: {
    height: 44,
    width: "auto",
    maxWidth: "min(100%, 220px)",
    objectFit: "contain",
    display: "block",
  },
  nav: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginBottom: 0,
    justifyContent: "flex-end",
    flex: 1,
    minWidth: 0,
  },
  navMain: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", flex: 1, minWidth: 0 },
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
  navBtn: {
    background: "transparent",
    border: "none",
    color: "var(--muted)",
    borderRadius: 8,
    padding: "10px 14px",
    fontWeight: 600,
    fontSize: 14,
  },
  header: { marginBottom: 28 },
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
