import type { AppScreen } from "./AppSidebar.types";
import { AppNavigationFooter, AppNavigationList } from "./AppNavigation";

export type { AppScreen } from "./AppSidebar.types";

type Props = {
  screen: AppScreen;
  onNavigate: (screen: AppScreen) => void;
  /** Show Visitors (admin) when JWT user matches server ADMIN_EMAIL. */
  showVisitors?: boolean;
};

export default function AppSidebar({ screen, onNavigate, showVisitors }: Props) {
  return (
    <aside className="app-sidebar" aria-label="Primary">
      <div className="app-sidebar-top">
        <nav className="app-sidebar-nav">
          <AppNavigationList
            screen={screen}
            onNavigate={onNavigate}
            showVisitors={showVisitors}
            itemClass="app-sidebar-item"
            activeClass="app-sidebar-item--on"
          />
        </nav>
      </div>
      <AppNavigationFooter onNavigate={onNavigate} variant="sidebar" />
    </aside>
  );
}
