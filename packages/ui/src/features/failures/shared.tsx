import { type InfiniteData, useQueryClient } from "@tanstack/react-query";
import type { FailureGroupId, Page } from "@webfrost/sdk";
import { Check, ChevronRight, Copy, ExternalLink, Info } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { snapshotKeys } from "../../hooks/useSnapshots";
import { useCopy } from "../../lib/clipboard";

export const PAGE_SIZE = 50;

export const FAILURE_KEYS = {
  all: ["failures"] as const,
  groups: () => ["failures", "groups"] as const,
  domains: (group: string, q: string) => ["failures", "domains", group, q] as const,
  snapshots: (group: string, host: string) => ["failures", "snapshots", group, host] as const,
};

export const TRASH_KEYS = {
  all: ["trash"] as const,
  list: () => ["trash", "list"] as const,
};

export interface GroupInfo {
  /** One sentence for the overview card. */
  summary: string;
  /** Longer text for the group page. */
  details?: ReactNode;
}

export const GROUP_INFO: Record<FailureGroupId, GroupInfo> = {
  "domain-gone": {
    summary:
      "The name has no DNS record any more; retrying will not help unless the domain comes back.",
  },
  "page-gone": { summary: "The site answers, but the page is gone (404/410)." },
  blocked: {
    summary:
      "The site refuses requests from this server. A retry sometimes works, and you can archive these pages from your own computer with the webfrost CLI.",
    details: (
      <>
        <p className="m-0">
          The site refuses requests coming from this server: its IP address is in a datacenter, or
          an anti-bot check fails. A real browser running on the same server is refused too.
        </p>
        <p className="mb-0 mt-2">
          <strong>A retry sometimes works</strong>: the block can be temporary or depend on the time
          of day.
        </p>
        <p className="mb-0 mt-2">
          <strong>From your own computer</strong>, the webfrost CLI archives these pages with your
          connection and sends the ones that work to this server, each replacing its failure. Pages
          that are still refused there, or come back as an anti-bot page, are left as they are. It
          needs an API key of this server (<Link to="/settings/api-keys">Settings, API keys</Link>)
          in <code>WEBFROST_API_KEY</code>; <code>--dry-run</code> first lists what it would try.{" "}
          <a
            href="https://webfrost.dev/docs/guides/push#many-failed-pages-at-once"
            target="_blank"
            rel="noopener noreferrer"
          >
            How to
          </a>
        </p>
        <RescueCommand group="blocked" />
        <p className="mb-0 mt-2">
          <strong>Coming later:</strong> a WebFrost helper on your computer that does this
          automatically, as pages get blocked.
        </p>
      </>
    ),
  },
  "rate-limited": { summary: "The site asked to slow down (429)." },
  temporary: {
    summary: "Timeouts, server errors and network trouble; a retry often works.",
  },
  "site-setup": { summary: "TLS/certificate errors, redirect loops, rejected requests." },
  "private-address": {
    summary: "The address points to a private network, which WebFrost never archives.",
  },
  interrupted: { summary: "WebFrost did not finish the run (crash or restart)." },
  unknown: { summary: "Failed before WebFrost recorded why." },
};

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** The search box asks the server once typing pauses, not on every key. */
export function useDebounced(value: string, ms = 250): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Everything a mutation on failed or trashed snapshots can change. */
export function useRefreshAll() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: FAILURE_KEYS.all });
    queryClient.invalidateQueries({ queryKey: TRASH_KEYS.all });
    queryClient.invalidateQueries({ queryKey: snapshotKeys.all });
    queryClient.invalidateQueries({ queryKey: ["stats"] });
  };
}

export function nextPageParam(last: Page<unknown>): number | undefined {
  return last.page * last.limit < last.total ? last.page + 1 : undefined;
}

export function flatten<T>(data: InfiniteData<Page<T>> | undefined): T[] {
  return data?.pages.flatMap((p) => p.items) ?? [];
}

/** Loads the next page when scrolled into view; the button is the fallback (and the a11y path). */
export function LoadMore({
  hasNext,
  loading,
  onLoad,
}: {
  hasNext: boolean;
  loading: boolean;
  onLoad: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  useEffect(() => {
    const el = ref.current;
    if (!el || !hasNext || loading || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onLoadRef.current();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNext, loading]);

  if (!hasNext) return null;
  return (
    <div ref={ref} className="flex justify-center border-t border-border p-3">
      <Button variant="secondary" size="sm" disabled={loading} onClick={onLoad}>
        {loading ? "Loading…" : "Load more"}
      </Button>
    </div>
  );
}

export function Breadcrumb({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1 text-ui-sm">
      {items.map((item, i) => (
        <span key={item.label} className="flex min-w-0 items-center gap-1">
          {i > 0 && <ChevronRight size={12} aria-hidden className="text-low" />}
          {item.to ? (
            <Link to={item.to} className="text-mid">
              {item.label}
            </Link>
          ) : (
            <span className="truncate text-high" aria-current="page">
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function FailedOnlyNote() {
  return (
    <p className="mb-4 mt-0 flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-ui-sm text-high">
      <Info size={15} aria-hidden className="mt-0.5 shrink-0 text-accent" />
      <span>
        Only the snapshots that failed are affected. Earlier snapshots of the same pages that worked
        are kept.
      </span>
    </p>
  );
}

/** The bar that appears while something is selected. */
export function SelectionToolbar({
  summary,
  children,
}: {
  summary: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Selection"
      className="sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-overlay px-3 py-2 shadow-sm"
    >
      <span className="mr-auto text-ui-sm text-high">{summary}</span>
      {children}
    </div>
  );
}

/**
 * Click-anywhere row selection with Shift+click ranges. `apply` sets or clears a batch of keys;
 * `keys` is the on-screen order, which is what a range is measured in.
 */
export function useRowSelect<K>(
  keys: K[],
  isSelected: (key: K) => boolean,
  apply: (keys: K[], on: boolean) => void,
) {
  const last = useRef<K | null>(null);
  return (key: K, shift: boolean) => {
    const on = !isSelected(key);
    const from = last.current === null ? -1 : keys.indexOf(last.current);
    const to = keys.indexOf(key);
    if (shift && from >= 0 && to >= 0) {
      apply(keys.slice(Math.min(from, to), Math.max(from, to) + 1), on);
    } else {
      apply([key], on);
    }
    last.current = key;
  };
}

/** A table row that toggles its selection on click, Space or Enter; links and buttons inside keep their job. */
export function SelectRow({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: (shift: boolean) => void;
  children: ReactNode;
}) {
  return (
    <tr
      tabIndex={0}
      aria-selected={selected}
      onClick={(e: MouseEvent<HTMLTableRowElement>) => {
        if ((e.target as HTMLElement).closest("a, button")) return;
        onSelect(e.shiftKey);
      }}
      onKeyDown={(e: KeyboardEvent<HTMLTableRowElement>) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onSelect(e.shiftKey);
        }
      }}
      className={`cursor-pointer border-b border-border outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-accent ${
        selected ? "bg-accent/10 hover:bg-accent/15" : "hover:bg-subtle"
      }`}
    >
      {children}
    </tr>
  );
}

/** The checkbox cell: the visual state of the row, with the accent bar on the left when selected. */
export function SelectCell({ selected, label }: { selected: boolean; label: string }) {
  return (
    <td
      className={`w-12 border-l-2 py-2.5 pl-3 pr-2 align-top ${
        selected ? "border-l-accent" : "border-l-transparent"
      }`}
    >
      <input
        type="checkbox"
        aria-label={label}
        checked={selected}
        readOnly
        tabIndex={-1}
        className="mt-0.5 size-4 cursor-pointer"
      />
    </td>
  );
}

/** This server's address as the CLI's --from wants it (where the web UI is served, without the hash). */
export function serverUrl(): string {
  const { origin, pathname } = window.location;
  // Opened from a file or about:blank there is no address to give.
  if (!/^https?:/.test(origin)) return "<server>";
  return `${origin}${pathname.replace(/\/index\.html$/, "").replace(/\/+$/, "")}`;
}

/** `webfrost rescue` for a group, aimed at this server (read when shown, not when the module loads). */
function RescueCommand({ group }: { group: FailureGroupId }) {
  return <CommandBlock command={`webfrost rescue ${group} --from ${serverUrl()}`} />;
}

/** A shell command to run, with a copy button (like a code block in the docs). */
export function CommandBlock({ command }: { command: string }) {
  const { state, copy } = useCopy();
  const ref = useRef<HTMLElement>(null);
  async function onCopy() {
    const ok = await copy(command);
    // No clipboard on this origin: select the command so Ctrl/Cmd+C finishes the job.
    if (!ok && ref.current) window.getSelection()?.selectAllChildren(ref.current);
  }
  return (
    <div className="mb-0 mt-2 flex items-start gap-2 rounded-lg border border-border bg-subtle py-2 pl-3 pr-2">
      <pre className="m-0 min-w-0 flex-1 overflow-x-auto py-1 font-mono text-ui-sm text-high">
        <code ref={ref}>{command}</code>
      </pre>
      <button
        type="button"
        onClick={onCopy}
        aria-label={state === "copied" ? "Copied" : "Copy command"}
        title={
          state === "failed" ? "Could not copy: the command is selected, press Ctrl+C" : "Copy"
        }
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-mid hover:bg-surface hover:text-high"
      >
        {state === "copied" ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
      </button>
    </div>
  );
}

/** Opens the page itself, on the live site, in a new tab (http and https only). */
export function OriginalLink({ url }: { url: string }) {
  if (!/^https?:\/\//i.test(url)) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open the original page in a new tab"
      title="Open the original page in a new tab"
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-low hover:bg-subtle hover:text-high"
    >
      <ExternalLink size={14} aria-hidden />
    </a>
  );
}

/** The visible way into an item, at the right end of a row. */
export function OpenCell({ to, label }: { to: string; label: string }) {
  return (
    <td className="w-10 py-2 pr-3 text-right align-top">
      <Link
        to={to}
        aria-label={label}
        title={label}
        className="inline-flex size-7 items-center justify-center rounded-md text-mid hover:bg-subtle hover:text-high"
      >
        <ChevronRight size={16} aria-hidden />
      </Link>
    </td>
  );
}

/**
 * Selection for a list that can be partly loaded. Normally `items` are the selected keys; in "all"
 * mode every row counts as selected except the keys in `items` (the exclusions). Each key carries
 * a weight (e.g. the snapshots in a domain) so totals can be worked out without loading it all.
 */
export function useListSelection<K>(weightOf: (key: K) => number = () => 1) {
  const [state, setState] = useState<{ all: boolean; items: Map<K, number> }>({
    all: false,
    items: new Map(),
  });
  const weightRef = useRef(weightOf);
  weightRef.current = weightOf;

  const isSelected = (key: K) => (state.all ? !state.items.has(key) : state.items.has(key));
  const apply = (keys: K[], on: boolean) =>
    setState((prev) => {
      const items = new Map(prev.items);
      // In all mode, selecting a row removes its exclusion.
      const add = prev.all ? !on : on;
      for (const k of keys) {
        if (add) items.set(k, weightRef.current(k));
        else items.delete(k);
      }
      return { all: prev.all, items };
    });
  const clear = useCallback(() => setState({ all: false, items: new Map() }), []);
  const exitAll = useCallback(
    () => setState((prev) => (prev.all ? { all: false, items: new Map() } : prev)),
    [],
  );
  const enterAll = () => setState({ all: true, items: new Map() });
  const weight = [...state.items.values()].reduce((n, w) => n + w, 0);

  return {
    all: state.all,
    /** Selected keys (explicit mode) or excluded keys (all mode). */
    keys: [...state.items.keys()],
    /** Total weight of those keys. */
    weight,
    size: state.items.size,
    isSelected,
    apply,
    clear,
    exitAll,
    enterAll,
  };
}

/** Gmail-style bar over a list: "all loaded rows are selected" offers to select every match. */
export function SelectAllBanner({
  noun,
  loaded,
  total,
  selectedCount,
  allMode,
  allLoadedSelected,
  onSelectAll,
  onClear,
}: {
  noun: string;
  loaded: number;
  total: number;
  selectedCount: number;
  allMode: boolean;
  allLoadedSelected: boolean;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const offer = !allMode && allLoadedSelected && total > loaded;
  if (!allMode && !offer) return null;
  const linkCls =
    "cursor-pointer border-0 bg-transparent p-0 font-semibold text-accent-text underline";
  return (
    <div className="mb-3 rounded-lg border border-border bg-overlay px-3 py-2 text-center text-ui-sm text-high">
      {allMode ? (
        <>
          {selectedCount === total
            ? `All ${total.toLocaleString()} ${noun} are selected. `
            : `${selectedCount.toLocaleString()} of ${total.toLocaleString()} ${noun} are selected. `}
          <button type="button" className={linkCls} onClick={onClear}>
            Clear selection
          </button>
        </>
      ) : (
        <>
          All {loaded.toLocaleString()} {noun} on this page are selected.{" "}
          <button type="button" className={linkCls} onClick={onSelectAll}>
            Select all {total.toLocaleString()} {noun}
          </button>
        </>
      )}
    </div>
  );
}
