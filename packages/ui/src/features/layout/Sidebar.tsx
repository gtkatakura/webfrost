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
import type { ElementType, ReactNode } from "react";
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
  "flex w-full items-center gap-3 rounded-lg border-0 bg-transparent py-2 text-left text-ui-base no-underline transition-colors hover:no-underline";

function itemCls(compact: boolean, extra = "text-mid hover:bg-subtle hover:text-high") {
  return `${itemBase} ${compact ? "justify-center px-0" : "px-3"} ${extra}`;
}

/** A small, quiet heading over a group of links (hidden when the sidebar is icon-only). */
function SectionLabel({ children, compact }: { children: string; compact: boolean }) {
  if (compact) return <div className="mx-3 my-2 h-px bg-border" />;
  return (
    <div className="px-3 pt-4 pb-1.5 text-ui-xs font-semibold uppercase tracking-wider text-low">
      {children}
    </div>
  );
}

/** Icon-only button in the account row; the label is its tooltip and accessible name. */
function IconAction({
  label,
  onClick,
  children,
  danger = false,
  pressed,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className={`inline-flex size-9 items-center justify-center rounded-lg border-0 bg-transparent text-mid transition-colors hover:bg-subtle ${
        danger ? "hover:text-danger" : "hover:text-high"
      }`}
    >
      {children}
    </button>
  );
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
      <Icon size={18} aria-hidden="true" className={`shrink-0 ${active ? "text-accent" : ""}`} />
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
      <div className="px-3">
        <button
          type="button"
          onClick={props.onOpenSearch}
          title={compact ? `Search (${MOD_KEY} K)` : undefined}
          aria-label={compact ? "Search" : undefined}
          aria-keyshortcuts="Control+K Meta+K"
          className={`flex w-full items-center gap-3 rounded-lg border border-border bg-overlay py-2 text-ui-base text-mid transition-colors hover:border-border-strong hover:bg-subtle ${
            compact ? "justify-center px-0" : "px-3"
          }`}
        >
          <Search size={18} aria-hidden="true" className="shrink-0" />
          {!compact && (
            <>
              <span className="flex-1 text-left">Search…</span>
              <kbd className="kbd">{MOD_KEY} K</kbd>
            </>
          )}
        </button>
      </div>

      <nav aria-label="Main" className="flex flex-col px-3">
        <SectionLabel compact={compact}>Archive</SectionLabel>
        <div className="flex flex-col gap-1">
          {primary.map((entry) => (
            <NavItem key={entry.to} entry={entry} active={isActive(entry.to)} compact={compact} />
          ))}
        </div>
        {secondary.length > 0 && (
          <>
            <SectionLabel compact={compact}>Manage</SectionLabel>
            <div className="flex flex-col gap-1">
              {secondary.map((entry) => (
                <NavItem
                  key={entry.to}
                  entry={entry}
                  active={isActive(entry.to)}
                  compact={compact}
                />
              ))}
            </div>
          </>
        )}
      </nav>

      {/* Account and preferences */}
      <div className="mt-auto border-t border-border px-3 py-3">
        {canWrite && username && !compact && (
          <div className="mb-2 flex items-center gap-3 rounded-lg px-2 py-2">
            <span
              aria-hidden="true"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-ui-base font-semibold text-accent"
            >
              {username.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ui-base font-medium text-high" title={username}>
                {username}
              </span>
              <span className="block text-ui-xs text-low">Admin</span>
            </span>
          </div>
        )}

        {isGuest && !compact && (
          <span
            className="mb-2 flex items-center gap-2 px-3 py-1 text-ui-sm text-low"
            title="You are browsing a public, read-only archive"
          >
            <Eye size={14} aria-hidden="true" />
            Read-only archive
          </span>
        )}

        <div className={`flex gap-1 ${compact ? "flex-col items-center" : "items-center"}`}>
          <IconAction
            label={props.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            onClick={props.onToggleTheme}
            pressed={props.theme === "dark"}
          >
            {props.theme === "dark" ? (
              <Sun size={18} aria-hidden="true" />
            ) : (
              <Moon size={18} aria-hidden="true" />
            )}
          </IconAction>
          <IconAction label="Keyboard shortcuts" onClick={props.onOpenShortcuts}>
            <KeyboardIcon size={18} aria-hidden="true" />
          </IconAction>
          {!compact && <span className="flex-1" />}
          {isGuest && (
            <Link
              to="/login"
              state={{ from: `${location.pathname}${location.search}` }}
              title={compact ? "Sign in" : undefined}
              aria-label={compact ? "Sign in" : undefined}
              className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-ui-base font-medium text-accent no-underline hover:bg-subtle hover:no-underline ${
                compact ? "w-9 justify-center px-0" : ""
              }`}
            >
              <LogIn size={18} aria-hidden="true" />
              {!compact && "Sign in"}
            </Link>
          )}
          {canWrite && (
            <IconAction label="Sign out" onClick={props.onLogout} danger>
              <LogOut size={18} aria-hidden="true" />
            </IconAction>
          )}
        </div>
      </div>
    </div>
  );
}
