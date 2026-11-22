import { useQuery } from "@tanstack/react-query";
import type { SnapshotDetail } from "@webfrost/sdk";
import {
  BookOpen,
  Camera,
  Download,
  Film,
  Globe,
  History,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  X,
} from "lucide-react";
import { type ElementType, useEffect, useRef, useState } from "react";
import { Modal } from "../../../components/ui/Modal";
import { ErrorState, Skeleton } from "../../../components/ui/StateViews";
import { useClient } from "../../../context";
import { useAuth } from "../../../context/auth";
import { PENDING_POLL_MS, snapshotKeys, useDeleteSnapshot } from "../../../hooks/useSnapshots";
import { MetadataSidebar } from "./MetadataSidebar";
import {
  HistoryTab,
  MediaTab,
  PageTab,
  RawTab,
  ReaderTab,
  ScreenshotTab,
  findResult,
} from "./tabs";

type TabId = "page" | "reader" | "screenshot" | "media" | "raw" | "history";

const TABS: { id: TabId; label: string; Icon: ElementType }[] = [
  { id: "page", label: "Page", Icon: Globe },
  { id: "reader", label: "Reader", Icon: BookOpen },
  { id: "screenshot", label: "Screenshot", Icon: Camera },
  { id: "media", label: "Media", Icon: Film },
  { id: "raw", label: "Files", Icon: Download },
  { id: "history", label: "History", Icon: History },
];

function defaultTab(detail: SnapshotDetail): TabId | null {
  const extractors = new Set(detail.archiveResults.map((r) => r.extractor));
  if (extractors.has("singlefile") || extractors.has("dom-snapshot")) return "page";
  if (extractors.has("readability")) return "reader";
  if (extractors.has("screenshot")) return "screenshot";
  if (extractors.size > 0) return "raw";
  return null;
}

const EXPANDED_KEY = "webfrost-viewer-full";

/** The full-view choice is remembered per browser: whoever reads archives wants it every time. */
function readExpanded() {
  try {
    return localStorage.getItem(EXPANDED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeExpanded(value: boolean) {
  try {
    localStorage.setItem(EXPANDED_KEY, value ? "1" : "0");
  } catch {
    // Storage can be blocked; the toggle still works for this visit.
  }
}

const headerBtn =
  "hidden rounded border-0 bg-transparent p-1.5 text-mid transition-colors hover:bg-subtle hover:text-high sm:inline-flex";

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
  const [activeTab, setActiveTab] = useState<TabId>("page");
  const [expanded, setExpanded] = useState(readExpanded);
  // The details column takes room from the page: open beside the side panel, closed in full view.
  const [infoOpen, setInfoOpen] = useState(() => !readExpanded());
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

  function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    setInfoOpen(!next);
    writeExpanded(next);
  }

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
    <Modal onClose={onClose} labelledBy={titleId} variant={expanded ? "full" : "side"}>
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 id={titleId} className="m-0 truncate text-ui-base font-semibold text-high">
              {detail?.title ?? "Snapshot Detail"}
            </h2>
            {detail && <span className="shrink-0 font-mono text-ui-xs text-mid">#{detail.id}</span>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setInfoOpen((v) => !v)}
              className={headerBtn}
              aria-pressed={infoOpen}
              aria-label={infoOpen ? "Hide details" : "Show details"}
              title={infoOpen ? "Hide details" : "Show details"}
            >
              {infoOpen ? (
                <PanelRightClose size={16} aria-hidden="true" />
              ) : (
                <PanelRightOpen size={16} aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              onClick={toggleExpanded}
              className={headerBtn}
              aria-pressed={expanded}
              aria-label={expanded ? "Exit full view" : "Full view"}
              title={expanded ? "Exit full view" : "Full view"}
            >
              {expanded ? (
                <Minimize2 size={16} aria-hidden="true" />
              ) : (
                <Maximize2 size={16} aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded border-0 bg-transparent p-1.5 text-mid transition-colors hover:bg-subtle hover:text-high"
              aria-label="Close panel"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
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
                {activeTab === "page" && <PageTab results={results} />}
                {activeTab === "reader" && (
                  <ReaderTab result={findResult(results, "readability")} />
                )}
                {activeTab === "screenshot" && (
                  <ScreenshotTab result={findResult(results, "screenshot")} />
                )}
                {activeTab === "media" && <MediaTab snapshotId={detail.id} results={results} />}
                {activeTab === "raw" && <RawTab results={results} />}
                {activeTab === "history" && <HistoryTab results={results} />}
              </>
            )}
          </div>

          {/* Hidden only from md up: on a phone the details stack under the content. */}
          {detail && (
            <MetadataSidebar
              hidden={!infoOpen}
              detail={detail}
              onDelete={canWrite ? handleDelete : undefined}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
