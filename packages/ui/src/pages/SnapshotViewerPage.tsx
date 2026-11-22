import { useQuery } from "@tanstack/react-query";
import type { SnapshotDetail } from "@webfrost/sdk";
import {
  ArrowLeft,
  BookOpen,
  Camera,
  Download,
  Expand,
  ExternalLink,
  Film,
  Globe,
  Info,
} from "lucide-react";
import { type ElementType, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { StatusBadge } from "../components/StatusBadge";
import { ErrorState, Skeleton } from "../components/ui/StateViews";
import { useClient } from "../context";
import { useAuth } from "../context/auth";
import { MetadataSidebar } from "../features/snapshots/detail/MetadataSidebar";
import {
  HistoryTab,
  MediaTab,
  PageTab,
  RawTab,
  ReaderTab,
  ScreenshotTab,
  findResult,
  pageResult,
} from "../features/snapshots/detail/tabs";
import { PENDING_POLL_MS, snapshotKeys, useDeleteSnapshot } from "../hooks/useSnapshots";
import { parsePositiveInt } from "../lib/url";

type TabId = "page" | "reader" | "screenshot" | "media" | "raw" | "details";

const TABS: { id: TabId; label: string; Icon: ElementType }[] = [
  { id: "page", label: "Page", Icon: Globe },
  { id: "reader", label: "Reader", Icon: BookOpen },
  { id: "screenshot", label: "Screenshot", Icon: Camera },
  { id: "media", label: "Media", Icon: Film },
  { id: "raw", label: "Files", Icon: Download },
  { id: "details", label: "Details", Icon: Info },
];

function defaultTab(detail: SnapshotDetail): TabId | null {
  const extractors = new Set(detail.archiveResults.map((r) => r.extractor));
  // A video page is about the video: the archived YouTube page has no working player.
  if (extractors.has("media")) return "media";
  if (extractors.has("singlefile") || extractors.has("dom-snapshot")) return "page";
  if (extractors.has("readability")) return "reader";
  if (extractors.has("screenshot")) return "screenshot";
  if (extractors.size > 0) return "raw";
  return null;
}

/** Where Back goes: the list page the snapshot was opened from, when the app opened it. */
export interface ViewerState {
  back?: string;
}

const iconBtn =
  "inline-flex size-9 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-mid no-underline transition-colors hover:bg-subtle hover:text-high hover:no-underline";

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return Boolean(el?.closest("input, textarea, select, [contenteditable='true']"));
}

/**
 * One archived snapshot, on the whole window: the archived page (or another view of it) gets
 * everything below one slim bar. Details (status, tags, history, delete) are a view like the others.
 */
export function SnapshotViewerPage() {
  const client = useClient();
  const { canWrite } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ id: string }>();
  const snapshotId = parsePositiveInt(params.id ?? null);
  const back = (location.state as ViewerState | null)?.back ?? "/snapshots";

  const [activeTab, setActiveTab] = useState<TabId>("page");
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});
  const frameRef = useRef<HTMLIFrameElement>(null);
  // The default view is picked once per snapshot, not on every background refetch: otherwise
  // polling a pending snapshot would yank the user back from the view they chose.
  const defaultedFor = useRef<number | null>(null);

  const query = useQuery<SnapshotDetail | null>({
    queryKey: snapshotKeys.detail(snapshotId ?? 0),
    enabled: snapshotId !== null,
    queryFn: () => client.getSnapshot(snapshotId ?? 0),
    refetchInterval: (q) => (q.state.data?.status === "pending" ? PENDING_POLL_MS : false),
  });
  const detail = query.data ?? undefined;
  const loading = snapshotId !== null && query.isPending;
  const notFound = snapshotId === null || (!loading && !query.isError && query.data === null);
  const results = detail?.archiveResults ?? [];
  const page = pageResult(results);

  const deleteSnapshot = useDeleteSnapshot({ onDeleted: () => navigate(back) });

  useEffect(() => {
    if (!detail || defaultedFor.current === detail.id) return;
    defaultedFor.current = detail.id;
    const tab = defaultTab(detail);
    if (tab) setActiveTab(tab);
  }, [detail]);

  function fullScreen() {
    setActiveTab("page");
    // The frame exists once the Page view rendered; requestFullscreen needs the user's gesture,
    // which this click still is.
    requestAnimationFrame(() => frameRef.current?.requestFullscreen?.());
  }

  // Escape goes back to the list, F shows the page full screen, I toggles the details.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector("dialog[open]") || document.fullscreenElement) return;
      if (e.key === "Escape") navigate(back);
      else if (e.key === "f" && page) fullScreen();
      else if (e.key === "i") setActiveTab("details");
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function handleDelete() {
    if (!canWrite || deleteSnapshot.isPending || snapshotId === null) return;
    if (!window.confirm("Delete this snapshot and all its artifacts? This cannot be undone.")) {
      return;
    }
    deleteSnapshot.mutate(snapshotId);
  }

  function onTabKeyDown(e: React.KeyboardEvent) {
    const i = TABS.findIndex((t) => t.id === activeTab);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    const target = next === null ? undefined : TABS[next];
    if (!target) return;
    e.preventDefault();
    setActiveTab(target.id);
    tabRefs.current[target.id]?.focus();
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-app text-high">
      <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-surface px-2 py-1.5">
        <button
          type="button"
          onClick={() => navigate(back)}
          className={iconBtn}
          aria-label="Back to snapshots"
          title="Back (Esc)"
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </button>

        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="m-0 flex min-w-0 items-center gap-2 text-ui-sm font-semibold leading-tight">
            <span className="truncate">
              {detail?.title ?? detail?.url ?? (loading ? "Loading…" : "Snapshot")}
            </span>
            {detail && detail.status !== "done" && <StatusBadge status={detail.status} />}
          </h1>
          {detail && (
            <a
              href={detail.url}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate font-mono text-ui-xs text-mid no-underline hover:text-high"
              title="Open the live page"
            >
              {detail.url}
            </a>
          )}
        </div>

        {/* Below sm the views take a row of their own under the title. */}
        <div
          role="tablist"
          aria-label="Snapshot views"
          onKeyDown={onTabKeyDown}
          className="order-last flex w-full gap-0.5 overflow-x-auto rounded-lg bg-subtle p-0.5 sm:order-none sm:w-auto"
        >
          {TABS.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                ref={(el) => {
                  tabRefs.current[id] = el;
                }}
                type="button"
                role="tab"
                id={`tab-${id}`}
                aria-selected={active}
                aria-controls="viewer-panel"
                tabIndex={active ? 0 : -1}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-md border-0 px-2.5 py-1.5 text-ui-xs transition-colors ${
                  active
                    ? "bg-surface font-medium text-high shadow-sm"
                    : "bg-transparent text-mid hover:text-high"
                }`}
              >
                <Icon size={14} aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center">
          {page?.previewUrl && (
            <>
              <button
                type="button"
                onClick={fullScreen}
                className={iconBtn}
                aria-label="Full screen"
                title="Full screen (F)"
              >
                <Expand size={17} aria-hidden="true" />
              </button>
              <a
                href={page.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={iconBtn}
                aria-label="Open the archived page in a new tab"
                title="Open in a new tab"
              >
                <ExternalLink size={17} aria-hidden="true" />
              </a>
            </>
          )}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div
          role="tabpanel"
          id="viewer-panel"
          aria-labelledby={`tab-${activeTab}`}
          className="flex min-w-0 flex-1 flex-col overflow-hidden"
        >
          {loading && (
            <div className="flex flex-col gap-3 p-5" role="status" aria-label="Loading snapshot">
              {[80, 60, 100, 40, 70].map((w, i) => (
                <Skeleton
                  // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
                  key={i}
                  className={i === 0 ? "h-4" : "h-2.5"}
                  style={{ width: `${w}%` }}
                />
              ))}
            </div>
          )}

          {query.isError && (
            <ErrorState
              title="Could not load this snapshot"
              error={query.error}
              onRetry={() => query.refetch()}
              compact
            />
          )}

          {notFound && (
            <div role="alert" className="p-5">
              <p className="m-0 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-ui-base text-danger">
                Snapshot not found.
              </p>
            </div>
          )}

          {detail && (
            <>
              {activeTab === "page" && <PageTab results={results} frameRef={frameRef} />}
              {activeTab === "reader" && (
                <div className="mx-auto h-full w-full max-w-3xl">
                  <ReaderTab result={findResult(results, "readability")} />
                </div>
              )}
              {activeTab === "screenshot" && (
                <ScreenshotTab result={findResult(results, "screenshot")} />
              )}
              {activeTab === "media" && <MediaTab snapshotId={detail.id} results={results} />}
              {activeTab === "raw" && (
                <div className="mx-auto w-full max-w-2xl">
                  <RawTab results={results} />
                </div>
              )}
              {activeTab === "details" && (
                <div className="h-full overflow-y-auto">
                  <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-5">
                    <MetadataSidebar
                      detail={detail}
                      onDelete={canWrite ? handleDelete : undefined}
                    />
                    <section>
                      <h2 className="mb-2 mt-0 text-ui-sm font-semibold text-high">History</h2>
                      <div className="overflow-hidden rounded-lg border border-border">
                        <HistoryTab results={results} />
                      </div>
                    </section>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
