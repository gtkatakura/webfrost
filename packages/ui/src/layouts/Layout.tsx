import { Menu, Moon, Sun, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { CommandPalette } from "../components/CommandPalette";
import { Logo } from "../components/Logo";
import { useAuth } from "../context/auth";
import { useThemeContext } from "../context/theme";
import { ShortcutsModal } from "../features/layout/ShortcutsModal";
import { Sidebar } from "../features/layout/Sidebar";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { STORAGE_KEYS, readStorage, writeStorage } from "../lib/storage";

const DESKTOP_QUERY = "(min-width: 1024px)";

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggle } = useThemeContext();
  const { logout, username, isGuest, canWrite, publicRead } = useAuth();
  const isDesktop = useMediaQuery(DESKTOP_QUERY, true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => readStorage(STORAGE_KEYS.sidebarCollapsed) === "true",
  );
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  // The collapsed (icon-only) state is a desktop preference; the mobile drawer is always full.
  const compact = collapsed && isDesktop;
  // A closed drawer is off screen: keep it out of the tab order and the accessibility tree.
  const drawerClosed = !isDesktop && !drawerOpen;

  function toggleCollapsed() {
    setCollapsed((v) => {
      writeStorage(STORAGE_KEYS.sidebarCollapsed, String(!v));
      return !v;
    });
  }

  async function handleLogout() {
    try {
      await logout();
      // On a public instance the user becomes a guest: land on the dashboard, not /login.
      if (publicRead) navigate("/");
    } catch {
      toast.error("Logout failed. Please try again.");
    }
  }

  useKeyboardShortcuts({
    onToggleHelp: () => setShortcutsOpen((v) => !v),
    onOpenSearch: () => setPaletteOpen(true),
    canWrite,
  });

  // Close the drawer on navigation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: location.pathname triggers the effect
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // Drawer: Escape closes it and focus returns to the menu button; opening moves focus inside.
  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDrawerOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    drawerRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // Growing past the breakpoint with the drawer open would leave a stale scrim behind.
  useEffect(() => {
    if (isDesktop) setDrawerOpen(false);
  }, [isDesktop]);

  const inertProps = drawerClosed ? ({ inert: "" } as Record<string, string>) : {};

  return (
    <div className="flex min-h-dvh bg-app">
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}

      {/* ── Mobile header ─────────────────────────────────────── */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-12 items-center justify-between border-b border-border bg-surface px-4 lg:hidden">
        <Link to="/" className="rounded no-underline hover:no-underline" aria-label="WebFrost home">
          <Logo size={22} className="text-base" />
        </Link>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggle}
            aria-pressed={theme === "dark"}
            aria-label="Dark mode"
            className="rounded border-0 bg-transparent p-2 text-mid transition-colors hover:bg-subtle hover:text-high"
          >
            {theme === "dark" ? (
              <Sun size={16} aria-hidden="true" />
            ) : (
              <Moon size={16} aria-hidden="true" />
            )}
          </button>
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setDrawerOpen((v) => !v)}
            aria-label="Menu"
            aria-expanded={drawerOpen}
            aria-controls="app-sidebar"
            className="rounded border-0 bg-transparent p-2 text-mid transition-colors hover:bg-subtle hover:text-high"
          >
            {drawerOpen ? (
              <X size={18} aria-hidden="true" />
            ) : (
              <Menu size={18} aria-hidden="true" />
            )}
          </button>
        </div>
      </header>

      {/* ── Mobile scrim ──────────────────────────────────────── */}
      {drawerOpen && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: a pointer-only backdrop; Escape is handled on window
        <div
          className="fixed inset-0 z-30 bg-scrim lg:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar: a drawer below lg, a sticky column from lg up. Rendered once. ── */}
      <aside
        id="app-sidebar"
        ref={drawerRef}
        {...inertProps}
        className={`transition-panel fixed top-12 bottom-0 left-0 z-40 w-60 border-r pt-2 lg:pt-0 border-border bg-surface ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        } lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:translate-x-0 lg:shrink-0 ${
          compact ? "lg:w-14" : "lg:w-60"
        }`}
      >
        <Sidebar
          compact={compact}
          canWrite={canWrite}
          isGuest={isGuest}
          username={username}
          theme={theme}
          onToggleTheme={toggle}
          onToggleCompact={toggleCollapsed}
          onOpenSearch={() => {
            setDrawerOpen(false);
            setPaletteOpen(true);
          }}
          onOpenShortcuts={() => {
            setDrawerOpen(false);
            setShortcutsOpen(true);
          }}
          onLogout={handleLogout}
        />
      </aside>

      {/* ── Main content ──────────────────────────────────────── */}
      <div className="min-w-0 flex-1 pt-12 text-high lg:pt-0">
        <Outlet />
      </div>

      {shortcutsOpen && (
        <ShortcutsModal onClose={() => setShortcutsOpen(false)} canWrite={canWrite} />
      )}
    </div>
  );
}
