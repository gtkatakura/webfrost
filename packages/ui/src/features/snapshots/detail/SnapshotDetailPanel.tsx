import { useQuery } from "@tanstack/react-query";
import type { SnapshotDetail } from "@webfrost/sdk";
import { BookOpen, Camera, Download, Film, History, Monitor, X } from "lucide-react";
import { type ElementType, useEffect, useRef, useState } from "react";
import { Modal } from "../../../components/ui/Modal";
import { ErrorState, Skeleton } from "../../../components/ui/StateViews";
import { useClient } from "../../../context";
import { useAuth } from "../../../context/auth";
import { PENDING_POLL_MS, snapshotKeys, useDeleteSnapshot } from "../../../hooks/useSnapshots";
import { MetadataSidebar } from "./MetadataSidebar";
import { DomTab, HistoryTab, MediaTab, RawTab, ReaderTab, ScreenshotTab, findResult } from "./tabs";

type TabId = "reader" | "screenshot" | "dom" | "media" | "raw" | "history";

const TABS: { id: TabId; label: string; Icon: ElementType }[] = [
  { id: "reader", label: "Reader", Icon: BookOpen },
  { id: "screenshot", label: "Screenshot", Icon: Camera },
  { id: "dom", label: "DOM", Icon: Monitor },
  { id: "media", label: "Media", Icon: Film },
  { id: "raw", label: "Raw", Icon: Download },
  { id: "history", label: "History", Icon: History },
];

function defaultTab(detail: SnapshotDetail): TabId | null {
  const extractors = new Set(detail.archiveResults.map((r) => r.extractor));
  if (extractors.has("readability")) return "reader";
  if (extractors.has("screenshot")) return "screenshot";
  if (extractors.size > 0) return "raw";
  return null;
}

interface SnapshotDetailPanelProps {
  snapshotId: number;
  onClose: () => void;
  /** Called after this snapshot was deleted from the panel. */
  onDeleted: () => void | Promise<void>;
}

/** Slide-over with everything about one snapshot: the one detail UI of the app. */
export function SnapshotDetailPanel({ snapshotId, onClose, onDeleted }: SnapshotDetailPanelProps) {
  const client = useClient();
  const { canWrite } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>("reader");
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});
  // The default tab is picked once per snapshot, not on every background refetch: otherwise
  // polling a pending snapshot would yank the user back from the tab they chose.
  const defaultedFor = useRef<number | null>(null);

  const query = useQuery<SnapshotDetail | null>({
    queryKey: snapshotKeys.detail(snapshotId),
    queryFn: () => client.getSnapshot(snapshotId),
    refetchInterval: (q) => (q.state.data?.status === "pending" ? PENDING_POLL_MS : false),
  });
  const detail = query.data ?? undefined;
  const loading = query.isPending;
  const notFound = !loading && !query.isError && query.data === null;

  const deleteSnapshot = useDeleteSnapshot({ onDeleted });

  useEffect(() => {
    if (!detail || defaultedFor.current === detail.id) return;
    defaultedFor.current = detail.id;
    const tab = defaultTab(detail);
    if (tab) setActiveTab(tab);
  }, [detail]);

  function handleDelete() {
    if (!canWrite || deleteSnapshot.isPending) return;
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

  const titleId = `snapshot-title-${snapshotId}`;
  const results = detail?.archiveResults ?? [];

  return (
    <Modal onClose={onClose} labelledBy={titleId} variant="side">
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 id={titleId} className="m-0 truncate text-ui-base font-semibold text-high">
              {detail?.title ?? "Snapshot Detail"}
            </h2>
            {detail && <span className="shrink-0 font-mono text-ui-xs text-mid">#{detail.id}</span>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border-0 bg-transparent p-1.5 text-mid transition-colors hover:bg-subtle hover:text-high"
            aria-label="Close panel"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div
          role="tablist"
          aria-label="Snapshot views"
          onKeyDown={onTabKeyDown}
          className="flex shrink-0 overflow-x-auto border-b border-border"
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
                aria-controls={`tabpanel-${id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => setActiveTab(id)}
                className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-0 border-b-2 bg-transparent px-3 py-2.5 text-ui-xs transition-colors ${
                  active
                    ? "border-accent font-medium text-accent"
                    : "border-transparent text-mid hover:text-high"
                }`}
              >
                <Icon size={12} aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>

        {/* Below md the sidebar stacks under the content and the body scrolls as one. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
          <div
            role="tabpanel"
            id={`tabpanel-${activeTab}`}
            aria-labelledby={`tab-${activeTab}`}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: WAI-ARIA tabs pattern: the panel is focusable
            tabIndex={0}
            className="flex min-h-[55dvh] flex-1 flex-col overflow-hidden md:min-h-0"
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
                {activeTab === "reader" && (
                  <ReaderTab result={findResult(results, "readability")} />
                )}
                {activeTab === "screenshot" && (
                  <ScreenshotTab result={findResult(results, "screenshot")} />
                )}
                {activeTab === "dom" && <DomTab results={results} />}
                {activeTab === "media" && <MediaTab snapshotId={detail.id} results={results} />}
                {activeTab === "raw" && <RawTab results={results} />}
                {activeTab === "history" && <HistoryTab results={results} />}
              </>
            )}
          </div>

          {detail && (
            <MetadataSidebar detail={detail} onDelete={canWrite ? handleDelete : undefined} />
          )}
        </div>
      </div>
    </Modal>
  );
}
