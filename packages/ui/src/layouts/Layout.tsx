import {
  Calendar,
  Camera,
  KeyboardIcon,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sun,
  Tag,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../context/auth";
import { useThemeContext } from "../context/theme";
import { SHORTCUTS, useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";

const NAV_ITEMS = [
  { label: "Dashboard", to: "/", Icon: LayoutDashboard },
  { label: "Snapshots", to: "/snapshots", Icon: Camera },
  { label: "Tags", to: "/tags", Icon: Tag },
  { label: "Schedules", to: "/schedules", Icon: Calendar },
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="presentation"
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4 border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="presentation"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Keyboard Shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 bg-transparent border-0 cursor-pointer p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <ul className="list-none p-0 m-0 flex flex-col gap-2">
          {SHORTCUTS.map((s) => (
            <li key={s.description} className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-600 dark:text-gray-300">{s.description}</span>
              <span className="flex gap-1">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600"
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

export function Layout() {
  const location = useLocation();
  const { theme, toggle } = useThemeContext();
  const { logout, username } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  async function handleLogout() {
    try {
      await logout();
    } catch {
      toast.error("Logout failed. Please try again.");
    }
  }

  useKeyboardShortcuts({ onToggleHelp: () => setShortcutsOpen((v) => !v) });

  // Close mobile menu on route change — location.pathname is an intentional
  // trigger dependency, not consumed in the body (biome false positive).
  // biome-ignore lint/correctness/useExhaustiveDependencies: location.pathname triggers the effect
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  function isActive(to: string): boolean {
    if (to === "/") return location.pathname === "/";
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  }

  const sidebarContent = (
    <>
      <div className="flex items-center justify-between px-3 mb-4">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">WebFrost</span>
        <button
          type="button"
          onClick={toggle}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700 bg-transparent border-0 cursor-pointer transition-colors"
          aria-label="Toggle dark mode"
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
      <nav className="flex flex-col gap-0.5">
        {NAV_ITEMS.map(({ label, to, Icon }) => {
          const active = isActive(to);
          return (
            <Link
              key={to}
              to={to}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm no-underline transition-colors ${
                active
                  ? "bg-gray-700 text-white font-medium"
                  : "text-gray-400 hover:text-white hover:bg-gray-800"
              }`}
            >
              <Icon size={16} className={active ? "text-primary" : "text-gray-500"} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col gap-0.5 pt-4 border-t border-gray-800">
        {username && (
          <span className="px-3 py-1 text-xs text-gray-500 truncate" title={username}>
            {username}
          </span>
        )}
        <button
          type="button"
          onClick={() => setShortcutsOpen(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800 bg-transparent border-0 cursor-pointer text-left transition-colors"
        >
          <KeyboardIcon size={13} />
          Shortcuts
        </button>
        <button
          type="button"
          onClick={handleLogout}
          className="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-gray-500 hover:text-red-400 hover:bg-gray-800 bg-transparent border-0 cursor-pointer text-left transition-colors"
        >
          <LogOut size={13} />
          Sign out
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Mobile header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-12 bg-gray-900 text-gray-100 border-b border-gray-800">
        <span className="text-xs font-bold text-gray-300 uppercase tracking-widest">WebFrost</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggle}
            className="p-2 rounded text-gray-400 hover:text-white hover:bg-gray-800 bg-transparent border-0 cursor-pointer transition-colors"
            aria-label="Toggle dark mode"
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="p-2 rounded text-gray-400 hover:text-white hover:bg-gray-800 bg-transparent border-0 cursor-pointer transition-colors"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </header>

      {/* Mobile menu overlay */}
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

      {/* Mobile sidebar drawer */}
      <aside
        className={`lg:hidden fixed top-12 left-0 bottom-0 z-40 w-56 bg-gray-900 text-gray-100 flex flex-col py-4 px-3 gap-1 transition-transform duration-200 border-r border-gray-800 ${
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-56 shrink-0 bg-gray-900 text-gray-100 flex-col py-6 px-3 gap-1 min-h-screen border-r border-gray-800">
        {sidebarContent}
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 pt-12 lg:pt-0">
        <Outlet />
      </div>

      {shortcutsOpen && <KeyboardShortcutsModal onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}
