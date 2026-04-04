import {
  Calendar,
  Camera,
  ChevronLeft,
  ChevronRight,
  KeyboardIcon,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Search,
  Settings,
  Sun,
  Tag,
  Upload,
  X,
} from "lucide-react";
import { type ElementType, useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { CommandPalette } from "../components/CommandPalette";
import { useAuth } from "../context/auth";
import { useThemeContext } from "../context/theme";
import { SHORTCUTS, useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";

const SIDEBAR_KEY = "webfrost-sidebar-collapsed";

const PRIMARY_NAV: { label: string; to: string; Icon: ElementType }[] = [
  { label: "Dashboard", to: "/", Icon: LayoutDashboard },
  { label: "Snapshots", to: "/snapshots", Icon: Camera },
  { label: "Schedules", to: "/schedules", Icon: Calendar },
  { label: "Tags", to: "/tags", Icon: Tag },
];

const SECONDARY_NAV: { label: string; to: string; Icon: ElementType }[] = [
  { label: "Import", to: "/import", Icon: Upload },
  { label: "Settings", to: "/settings", Icon: Settings },
];

function KeyboardShortcutsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="presentation"
    >
      <div
        className="rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4 border"
        style={{
          background: "var(--bg-surface)",
          borderColor: "var(--border-default)",
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="presentation"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-ui-base font-semibold" style={{ color: "var(--text-high)" }}>
            Keyboard Shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded cursor-pointer border-0 transition-colors"
            style={{
              background: "transparent",
              color: "var(--text-mid)",
            }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <ul className="list-none p-0 m-0 flex flex-col gap-2">
          {SHORTCUTS.map((s) => (
            <li key={s.description} className="flex items-center justify-between gap-4">
              <span className="text-ui-sm" style={{ color: "var(--text-mid)" }}>
                {s.description}
              </span>
              <span className="flex gap-1">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="text-ui-xs font-mono px-2 py-0.5 rounded border"
                    style={{
                      background: "var(--bg-overlay)",
                      color: "var(--text-high)",
                      borderColor: "var(--border-strong)",
                    }}
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface NavItemProps {
  to: string;
  Icon: ElementType;
  label: string;
  active: boolean;
  collapsed: boolean;
}

function NavItem({ to, Icon, label, active, collapsed }: NavItemProps) {
  return (
    <Link
      to={to}
      title={collapsed ? label : undefined}
      className="flex items-center gap-2.5 rounded-md no-underline transition-colors relative group"
      style={{
        padding: collapsed ? "8px 0" : "7px 10px",
        justifyContent: collapsed ? "center" : "flex-start",
        color: active ? "var(--text-high)" : "var(--text-mid)",
        background: active ? "var(--bg-subtle)" : "transparent",
        borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
        fontWeight: active ? 500 : 400,
      }}
      onMouseEnter={(e) => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.color = "var(--text-high)";
          (e.currentTarget as HTMLElement).style.background = "var(--bg-subtle)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.color = "var(--text-mid)";
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }
      }}
    >
      <Icon size={16} style={{ color: active ? "var(--accent)" : "inherit", flexShrink: 0 }} />
      {!collapsed && <span className="text-ui-sm truncate">{label}</span>}
      {/* Tooltip for collapsed mode */}
      {collapsed && (
        <span
          className="absolute left-full ml-2 px-2 py-1 rounded text-ui-xs whitespace-nowrap z-50 pointer-events-none opacity-0 group-hover:opacity-100 transition-fade"
          style={{
            background: "var(--bg-overlay)",
            color: "var(--text-high)",
            border: "1px solid var(--border-default)",
          }}
        >
          {label}
        </span>
      )}
    </Link>
  );
}

export function Layout() {
  const location = useLocation();
  const { theme, toggle } = useThemeContext();
  const { logout, username } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "true";
    } catch {
      return false;
    }
  });

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(SIDEBAR_KEY, String(next));
      } catch {}
      return next;
    });
  }

  async function handleLogout() {
    try {
      await logout();
    } catch {
      toast.error("Logout failed. Please try again.");
    }
  }

  useKeyboardShortcuts({
    onToggleHelp: () => setShortcutsOpen((v) => !v),
    onOpenSearch: () => setPaletteOpen(true),
  });

  // Close mobile menu on route change
  // biome-ignore lint/correctness/useExhaustiveDependencies: location.pathname triggers the effect
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  function isActive(to: string): boolean {
    if (to === "/") return location.pathname === "/";
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  }

  const sidebarWidth = collapsed ? 56 : 240;

  const sidebarBody = (
    <div className="flex flex-col h-full" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
      {/* Logo / branding */}
      <div
        className="flex items-center px-3 mb-5"
        style={{
          height: 48,
          justifyContent: collapsed ? "center" : "space-between",
        }}
      >
        {!collapsed && (
          <span
            className="text-ui-xs font-bold tracking-widest uppercase select-none"
            style={{ color: "var(--text-low)" }}
          >
            WebFrost
          </span>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="p-1.5 rounded cursor-pointer border-0 transition-colors"
          style={{
            background: "transparent",
            color: "var(--text-low)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = "var(--text-high)";
            (e.currentTarget as HTMLElement).style.background = "var(--bg-subtle)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = "var(--text-low)";
            (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {/* Search trigger */}
      <div style={{ padding: "0 8px", marginBottom: 4 }}>
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          title={collapsed ? "Search (⌘K)" : undefined}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: collapsed ? "7px 0" : "7px 10px",
            justifyContent: collapsed ? "center" : "flex-start",
            background: "var(--bg-overlay)",
            border: "1px solid var(--border-default)",
            borderRadius: 6,
            cursor: "pointer",
            color: "var(--text-low)",
            fontSize: 12,
          }}
        >
          <Search size={13} style={{ flexShrink: 0 }} />
          {!collapsed && (
            <>
              <span style={{ flex: 1, textAlign: "left" }}>Search…</span>
              <kbd
                style={{
                  fontSize: 10,
                  padding: "1px 4px",
                  borderRadius: 3,
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-strong)",
                  fontFamily: "ui-monospace, monospace",
                  color: "var(--text-low)",
                }}
              >
                ⌘K
              </kbd>
            </>
          )}
        </button>
      </div>

      {/* Primary navigation */}
      <nav className="flex flex-col gap-0.5" style={{ padding: collapsed ? "0 8px" : "0 8px" }}>
        {PRIMARY_NAV.map(({ label, to, Icon }) => (
          <NavItem
            key={to}
            to={to}
            Icon={Icon}
            label={label}
            active={isActive(to)}
            collapsed={collapsed}
          />
        ))}
      </nav>

      {/* Divider */}
      <div className="my-3 mx-3" style={{ height: 1, background: "var(--border-default)" }} />

      {/* Secondary navigation */}
      <nav className="flex flex-col gap-0.5" style={{ padding: collapsed ? "0 8px" : "0 8px" }}>
        {SECONDARY_NAV.map(({ label, to, Icon }) => (
          <NavItem
            key={to}
            to={to}
            Icon={Icon}
            label={label}
            active={isActive(to)}
            collapsed={collapsed}
          />
        ))}
      </nav>

      {/* Bottom section */}
      <div
        className="mt-auto flex flex-col gap-0.5 pt-3"
        style={{
          borderTop: "1px solid var(--border-default)",
          padding: collapsed ? "12px 8px 12px" : "12px 8px 12px",
        }}
      >
        {/* Theme toggle */}
        <button
          type="button"
          onClick={toggle}
          title={
            collapsed
              ? theme === "dark"
                ? "Switch to light mode"
                : "Switch to dark mode"
              : undefined
          }
          className="flex items-center gap-2 rounded-md cursor-pointer border-0 transition-colors text-left"
          style={{
            padding: collapsed ? "7px 0" : "7px 10px",
            justifyContent: collapsed ? "center" : "flex-start",
            background: "transparent",
            color: "var(--text-mid)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = "var(--text-high)";
            (e.currentTarget as HTMLElement).style.background = "var(--bg-subtle)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = "var(--text-mid)";
            (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
        >
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          {!collapsed && (
            <span className="text-ui-xs">{theme === "dark" ? "Light mode" : "Dark mode"}</span>
          )}
        </button>

        {/* Username */}
        {!collapsed && username && (
          <span
            className="px-2.5 py-1 text-ui-xs truncate"
            title={username}
            style={{ color: "var(--text-low)" }}
          >
            {username}
          </span>
        )}

        {/* Keyboard shortcuts */}
        <button
          type="button"
          onClick={() => setShortcutsOpen(true)}
          title={collapsed ? "Keyboard shortcuts" : undefined}
          className="flex items-center gap-2 rounded-md cursor-pointer border-0 transition-colors text-left"
          style={{
            padding: collapsed ? "7px 0" : "7px 10px",
            justifyContent: collapsed ? "center" : "flex-start",
            background: "transparent",
            color: "var(--text-mid)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = "var(--text-high)";
            (e.currentTarget as HTMLElement).style.background = "var(--bg-subtle)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = "var(--text-mid)";
            (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
        >
          <KeyboardIcon size={14} />
          {!collapsed && <span className="text-ui-xs">Shortcuts</span>}
        </button>

        {/* Sign out */}
        <button
          type="button"
          onClick={handleLogout}
          title={collapsed ? "Sign out" : undefined}
          className="flex items-center gap-2 rounded-md cursor-pointer border-0 transition-colors text-left"
          style={{
            padding: collapsed ? "7px 0" : "7px 10px",
            justifyContent: collapsed ? "center" : "flex-start",
            background: "transparent",
            color: "var(--text-mid)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = "var(--status-danger)";
            (e.currentTarget as HTMLElement).style.background = "var(--bg-subtle)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = "var(--text-mid)";
            (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
        >
          <LogOut size={14} />
          {!collapsed && <span className="text-ui-xs">Sign out</span>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg-app)" }}>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      {/* ── Mobile header ─────────────────────────────────────── */}
      <header
        className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4"
        style={{
          height: 48,
          background: "var(--bg-surface)",
          borderBottom: "1px solid var(--border-default)",
          color: "var(--text-high)",
        }}
      >
        <span
          className="text-ui-xs font-bold tracking-widest uppercase"
          style={{ color: "var(--text-low)" }}
        >
          WebFrost
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggle}
            className="p-2 rounded cursor-pointer border-0 transition-colors"
            style={{ background: "transparent", color: "var(--text-mid)" }}
            aria-label="Toggle dark mode"
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="p-2 rounded cursor-pointer border-0 transition-colors"
            style={{ background: "transparent", color: "var(--text-mid)" }}
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </header>

      {/* ── Mobile overlay ────────────────────────────────────── */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 z-30 bg-black/50"
          onClick={() => setMobileMenuOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setMobileMenuOpen(false);
          }}
          role="presentation"
        />
      )}

      {/* ── Mobile sidebar drawer ─────────────────────────────── */}
      <aside
        className={`lg:hidden fixed top-12 left-0 bottom-0 z-40 flex flex-col transition-panel ${
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{
          width: 240,
          background: "var(--bg-surface)",
          borderRight: "1px solid var(--border-default)",
          paddingTop: 16,
        }}
      >
        {sidebarBody}
      </aside>

      {/* ── Desktop sidebar ───────────────────────────────────── */}
      <aside
        className="hidden lg:flex shrink-0 flex-col transition-panel"
        style={{
          width: sidebarWidth,
          minWidth: sidebarWidth,
          minHeight: "100vh",
          background: "var(--bg-surface)",
          borderRight: "1px solid var(--border-default)",
          paddingTop: 16,
          paddingBottom: 8,
          position: "sticky",
          top: 0,
          height: "100vh",
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        {sidebarBody}
      </aside>

      {/* ── Main content ──────────────────────────────────────── */}
      <div className="flex-1 min-w-0 pt-12 lg:pt-0" style={{ color: "var(--text-high)" }}>
        <Outlet />
      </div>

      {shortcutsOpen && <KeyboardShortcutsModal onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}
