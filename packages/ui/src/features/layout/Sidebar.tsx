import {
  Calendar,
  Camera,
  ChevronLeft,
  ChevronRight,
  Eye,
  KeyboardIcon,
  LayoutDashboard,
  LogIn,
  LogOut,
  Moon,
  Search,
  Settings,
  Sun,
  Tag,
  Upload,
} from "lucide-react";
import type { ElementType } from "react";
import { Link, useLocation } from "react-router-dom";
import { Logo, Mark } from "../../components/Logo";

interface NavEntry {
  label: string;
  to: string;
  Icon: ElementType;
  /** Write-only pages: hidden from read-only guests. */
  writeOnly?: boolean;
}

const PRIMARY_NAV: NavEntry[] = [
  { label: "Dashboard", to: "/", Icon: LayoutDashboard },
  { label: "Snapshots", to: "/snapshots", Icon: Camera },
  { label: "Schedules", to: "/schedules", Icon: Calendar, writeOnly: true },
  { label: "Tags", to: "/tags", Icon: Tag },
];

const SECONDARY_NAV: NavEntry[] = [
  { label: "Import", to: "/import", Icon: Upload, writeOnly: true },
  { label: "Settings", to: "/settings", Icon: Settings, writeOnly: true },
];

export const MOD_KEY =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

const itemBase =
  "flex w-full items-center gap-2.5 rounded-md border-0 bg-transparent py-1.5 text-left text-ui-sm no-underline transition-colors hover:no-underline";

function itemCls(compact: boolean, extra = "text-mid hover:bg-subtle hover:text-high") {
  return `${itemBase} ${compact ? "justify-center px-0" : "px-2.5"} ${extra}`;
}

function NavItem({
  entry,
  active,
  compact,
}: {
  entry: NavEntry;
  active: boolean;
  compact: boolean;
}) {
  const { Icon, label, to } = entry;
  return (
    <Link
      to={to}
      title={compact ? label : undefined}
      aria-label={compact ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={`${itemCls(
        compact,
        active
          ? "bg-subtle font-medium text-high shadow-[inset_2px_0_0_0_var(--accent)]"
          : "text-mid hover:bg-subtle hover:text-high",
      )}`}
    >
      <Icon size={16} aria-hidden="true" className={`shrink-0 ${active ? "text-accent" : ""}`} />
      {!compact && <span className="truncate">{label}</span>}
    </Link>
  );
}

interface SidebarProps {
  compact: boolean;
  canWrite: boolean;
  isGuest: boolean;
  username: string | null;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onToggleCompact: () => void;
  onOpenSearch: () => void;
  onOpenShortcuts: () => void;
  onLogout: () => void;
}

/** Everything inside the sidebar; the Layout decides whether it is a drawer or a fixed column. */
export function Sidebar(props: SidebarProps) {
  const { compact, canWrite, isGuest, username } = props;
  const location = useLocation();

  const isActive = (to: string) =>
    to === "/"
      ? location.pathname === "/"
      : location.pathname === to || location.pathname.startsWith(`${to}/`);

  const primary = PRIMARY_NAV.filter((n) => canWrite || !n.writeOnly);
  const secondary = SECONDARY_NAV.filter((n) => canWrite || !n.writeOnly);

  return (
    <div className="flex h-full flex-col overflow-y-auto overflow-x-hidden">
      {/* Brand (the mobile header carries its own) */}
      <div
        className={`mb-3 hidden h-14 shrink-0 items-center lg:flex ${
          compact ? "justify-center" : "justify-between px-4"
        }`}
      >
        {compact ? (
          <Mark size={26} />
        ) : (
          <Link
            to="/"
            className="rounded no-underline hover:no-underline"
            aria-label="WebFrost home"
          >
            <Logo className="text-lg" />
          </Link>
        )}
        {!compact && (
          <button
            type="button"
            onClick={props.onToggleCompact}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="rounded border-0 bg-transparent p-1.5 text-low transition-colors hover:bg-subtle hover:text-high"
          >
            <ChevronLeft size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {compact && (
        <button
          type="button"
          onClick={props.onToggleCompact}
          aria-label="Expand sidebar"
          title="Expand sidebar"
          className="mx-auto mb-2 hidden rounded border-0 bg-transparent p-1.5 text-low transition-colors hover:bg-subtle hover:text-high lg:inline-flex"
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      )}

      {/* Search trigger */}
      <div className="mb-2 px-2">
        <button
          type="button"
          onClick={props.onOpenSearch}
          title={compact ? `Search (${MOD_KEY} K)` : undefined}
          aria-label={compact ? "Search" : undefined}
          aria-keyshortcuts="Control+K Meta+K"
          className={`flex w-full items-center gap-2 rounded-md border border-border bg-overlay py-1.5 text-ui-sm text-mid transition-colors hover:border-border-strong hover:bg-subtle ${
            compact ? "justify-center px-0" : "px-2.5"
          }`}
        >
          <Search size={14} aria-hidden="true" className="shrink-0" />
          {!compact && (
            <>
              <span className="flex-1 text-left">Search…</span>
              <kbd className="kbd">{MOD_KEY} K</kbd>
            </>
          )}
        </button>
      </div>

      <nav aria-label="Main" className="flex flex-col gap-0.5 px-2">
        {primary.map((entry) => (
          <NavItem key={entry.to} entry={entry} active={isActive(entry.to)} compact={compact} />
        ))}
      </nav>

      {secondary.length > 0 && (
        <>
          <div className="mx-3 my-3 h-px bg-border" />
          {/* Not a second nav landmark: it belongs to the main navigation above. */}
          <div className="flex flex-col gap-0.5 px-2">
            {secondary.map((entry) => (
              <NavItem key={entry.to} entry={entry} active={isActive(entry.to)} compact={compact} />
            ))}
          </div>
        </>
      )}

      {/* Bottom section */}
      <div className="mt-auto flex flex-col gap-0.5 border-t border-border px-2 py-3">
        <button
          type="button"
          onClick={props.onToggleTheme}
          aria-pressed={props.theme === "dark"}
          title={compact ? "Dark mode" : undefined}
          aria-label={compact ? "Dark mode" : undefined}
          className={itemCls(compact)}
        >
          {props.theme === "dark" ? (
            <Sun size={14} aria-hidden="true" />
          ) : (
            <Moon size={14} aria-hidden="true" />
          )}
          {!compact && <span className="text-ui-xs">Dark mode</span>}
        </button>

        <button
          type="button"
          onClick={props.onOpenShortcuts}
          title={compact ? "Keyboard shortcuts" : undefined}
          aria-label={compact ? "Keyboard shortcuts" : undefined}
          className={itemCls(compact)}
        >
          <KeyboardIcon size={14} aria-hidden="true" />
          {!compact && <span className="text-ui-xs">Shortcuts</span>}
        </button>

        {/* Guest: read-only indicator + sign in */}
        {isGuest && (
          <>
            {!compact && (
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-ui-xs text-low"
                title="You are browsing a public, read-only archive"
              >
                <Eye size={11} aria-hidden="true" />
                Read-only
              </span>
            )}
            <Link
              to="/login"
              state={{ from: `${location.pathname}${location.search}` }}
              title={compact ? "Sign in" : undefined}
              aria-label={compact ? "Sign in" : undefined}
              className={itemCls(compact)}
            >
              <LogIn size={14} aria-hidden="true" />
              {!compact && <span className="text-ui-xs">Sign in</span>}
            </Link>
          </>
        )}

        {canWrite && !compact && username && (
          <span className="truncate px-2.5 py-1 text-ui-xs text-low" title={username}>
            {username}
          </span>
        )}
        {canWrite && (
          <button
            type="button"
            onClick={props.onLogout}
            title={compact ? "Sign out" : undefined}
            aria-label={compact ? "Sign out" : undefined}
            className={itemCls(compact, "text-mid hover:bg-subtle hover:text-danger")}
          >
            <LogOut size={14} aria-hidden="true" />
            {!compact && <span className="text-ui-xs">Sign out</span>}
          </button>
        )}
      </div>
    </div>
  );
}
