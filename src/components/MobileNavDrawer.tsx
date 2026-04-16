import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { AppScreen } from "./AppSidebar.types";
import { AppNavigationFooter, AppNavigationList } from "./AppNavigation";

type Props = {
  open: boolean;
  onClose: () => void;
  screen: AppScreen;
  onNavigate: (id: AppScreen) => void;
  showVisitors?: boolean;
};

export default function MobileNavDrawer({ open, onClose, screen, onNavigate, showVisitors }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 769px)");
    const onWide = () => {
      if (mq.matches) onClose();
    };
    mq.addEventListener("change", onWide);
    return () => mq.removeEventListener("change", onWide);
  }, [onClose]);

  const handleNav = (id: AppScreen) => {
    onNavigate(id);
    onClose();
  };

  const node =
    open ? (
      <>
        <div className="app-mobile-nav-backdrop" onClick={onClose} aria-hidden />
        <div
          id="app-mobile-nav-panel"
          className="app-mobile-nav-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="app-mobile-nav-title"
        >
          <div className="app-mobile-nav-panel-head">
            <h2 id="app-mobile-nav-title" className="app-mobile-nav-panel-title">
              Menu
            </h2>
            <button type="button" className="app-mobile-nav-close" onClick={onClose} aria-label="Close menu">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <nav className="app-mobile-nav-primary" aria-label="Primary">
            <AppNavigationList
              screen={screen}
              onNavigate={handleNav}
              showVisitors={showVisitors}
              itemClass="app-mobile-nav-item"
              activeClass="app-mobile-nav-item--on"
            />
          </nav>
          <AppNavigationFooter onNavigate={handleNav} variant="mobile" />
        </div>
      </>
    ) : null;

  if (typeof document === "undefined") return null;
  return createPortal(node, document.body);
}
