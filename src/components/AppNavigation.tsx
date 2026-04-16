import type { CSSProperties, ReactNode } from "react";
import type { AppScreen } from "./AppSidebar.types";

const iconWrap: CSSProperties = {
  flexShrink: 0,
  width: 18,
  height: 18,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "currentColor",
};

function NavIconHome() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function NavIconBook() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function NavIconPerps() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function NavIconHistory() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6l4 2" strokeLinecap="round" />
    </svg>
  );
}

function NavIconPrize() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 2l2.4 7.4h7.6l-6 4.6 2.3 7-6-4.5-6 4.5 2.3-7-6-4.6h7.6z" strokeLinejoin="round" />
    </svg>
  );
}

function NavIconLeaderboard() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M8 21V7M16 21v-6M12 21V3" strokeLinecap="round" />
    </svg>
  );
}

function NavIconAccount() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}

function NavIconVisitors() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

const mainAppItemsBase: { id: AppScreen; label: string; Icon: () => ReactNode }[] = [
  { id: "landing", label: "Home", Icon: NavIconHome },
  { id: "trade", label: "Trade", Icon: NavIconPerps },
  { id: "history", label: "History", Icon: NavIconHistory },
  { id: "sellQusd", label: "Prize", Icon: NavIconPrize },
  { id: "leaderboard", label: "Leaderboard", Icon: NavIconLeaderboard },
  { id: "account", label: "Account", Icon: NavIconAccount },
  { id: "quickstart", label: "Quick start", Icon: NavIconBook },
];

const visitorsItem = { id: "visitors" as const, label: "Visitors", Icon: NavIconVisitors };

export const APP_VERSION_SEMVER = "1.0.0";
export const APP_VERSION_DATE = "16-Apr-26";

type NavListProps = {
  screen: AppScreen;
  onNavigate: (id: AppScreen) => void;
  showVisitors?: boolean;
  /** e.g. app-sidebar-item or app-mobile-nav-item */
  itemClass: string;
  activeClass: string;
};

export function AppNavigationList({ screen, onNavigate, showVisitors, itemClass, activeClass }: NavListProps) {
  const mainAppItems = showVisitors ? [...mainAppItemsBase, visitorsItem] : mainAppItemsBase;
  return (
    <>
      {mainAppItems.map(({ id, label, Icon }) => {
        const on = screen === id;
        return (
          <button
            key={id}
            type="button"
            className={on ? `${itemClass} ${activeClass}` : itemClass}
            title={label}
            onClick={() => onNavigate(id)}
          >
            <span style={iconWrap} aria-hidden>
              <Icon />
            </span>
            {label}
          </button>
        );
      })}
    </>
  );
}

type FooterProps = {
  onNavigate: (id: AppScreen) => void;
  variant: "sidebar" | "mobile";
};

export function AppNavigationFooter({ onNavigate, variant }: FooterProps) {
  const legalBtnClass = variant === "sidebar" ? "app-sidebar-legal-btn" : "app-mobile-nav-legal-btn";
  return (
    <footer
      className={variant === "sidebar" ? "app-sidebar-footer" : "app-mobile-nav-footer"}
      title={`Solve Quest ${APP_VERSION_SEMVER}`}
    >
      <div className={variant === "sidebar" ? "app-sidebar-legal" : "app-mobile-nav-legal"}>
        <button type="button" className={legalBtnClass} onClick={() => onNavigate("terms")}>
          Terms
        </button>
        <span className="app-sidebar-legal-sep" aria-hidden>
          ·
        </span>
        <button type="button" className={legalBtnClass} onClick={() => onNavigate("privacy")}>
          Privacy
        </button>
      </div>
      <div className={variant === "sidebar" ? "app-sidebar-version" : "app-mobile-nav-version"}>
        v{APP_VERSION_SEMVER} · {APP_VERSION_DATE}
      </div>
    </footer>
  );
}
