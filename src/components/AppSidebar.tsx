import type { CSSProperties, ReactNode } from "react";
import type { AppScreen } from "./AppSidebar.types";

export type { AppScreen } from "./AppSidebar.types";

type Props = {
  screen: AppScreen;
  onNavigate: (screen: AppScreen) => void;
  /** Main app: full nav without Admin. Admin host: link home + Admin only. */
  variant: "mainApp" | "adminSubdomain";
  mainSiteOrigin: string;
};

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

function NavIconAccount() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}

function NavIconAdmin() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

const mainAppItems: { id: AppScreen; label: string; Icon: () => ReactNode }[] = [
  { id: "landing", label: "Home", Icon: NavIconHome },
  { id: "trade", label: "Perpetuals", Icon: NavIconPerps },
  { id: "history", label: "History", Icon: NavIconHistory },
  { id: "account", label: "Account", Icon: NavIconAccount },
  { id: "quickstart", label: "Quick start", Icon: NavIconBook },
];

/** Shown in sidebar footer: semver + release stamp (d-mmm-yy). */
const APP_VERSION_SEMVER = "1.0.0";
const APP_VERSION_DATE = "12-Apr-26";

export default function AppSidebar({ screen, onNavigate, variant, mainSiteOrigin }: Props) {
  if (variant === "adminSubdomain") {
    return (
      <aside className="app-sidebar" aria-label="Admin">
        <div className="app-sidebar-top">
          <nav className="app-sidebar-nav">
            <a
              href={mainSiteOrigin}
              className="app-sidebar-item"
              rel="noopener noreferrer"
            >
              <span style={iconWrap} aria-hidden>
                <NavIconHome />
              </span>
              Main site
            </a>
            <div className="app-sidebar-item app-sidebar-item--on app-sidebar-item--static" role="presentation">
              <span style={iconWrap} aria-hidden>
                <NavIconAdmin />
              </span>
              Admin
            </div>
          </nav>
        </div>
        <footer className="app-sidebar-footer" title={`Solve Quest ${APP_VERSION_SEMVER}`}>
          v{APP_VERSION_SEMVER} · {APP_VERSION_DATE}
        </footer>
      </aside>
    );
  }

  return (
    <aside className="app-sidebar" aria-label="Primary">
      <div className="app-sidebar-top">
        <nav className="app-sidebar-nav">
          {mainAppItems.map(({ id, label, Icon }) => {
            const on = screen === id;
            return (
              <button
                key={id}
                type="button"
                className={`app-sidebar-item${on ? " app-sidebar-item--on" : ""}`}
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
        </nav>
      </div>
      <footer className="app-sidebar-footer" title={`Solve Quest ${APP_VERSION_SEMVER}`}>
        v{APP_VERSION_SEMVER} · {APP_VERSION_DATE}
      </footer>
    </aside>
  );
}
