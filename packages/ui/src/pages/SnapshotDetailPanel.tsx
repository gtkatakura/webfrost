import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { WebFrostError } from "@webfrost/sdk";
import type { ArchiveResult, SnapshotDetail, Tag } from "@webfrost/sdk";
import {
  BookOpen,
  Camera,
  Clock,
  Copy,
  Download,
  Film,
  History,
  Monitor,
  Plus,
  RefreshCcw,
  Tag as TagIcon,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useClient } from "../context";
import { snapshotKeys } from "../hooks/useSnapshots";
import { tagKeys } from "../hooks/useTags";

// ─── Types ────────────────────────────────────────────────────

type TabId = "reader" | "screenshot" | "dom" | "media" | "raw" | "history";

interface ReadabilityContent {
  title?: string;
  byline?: string;
  content?: string;
  excerpt?: string;
}

// ─── Helpers ──────────────────────────────────────────────────

function archiveUrl(snapshotId: number, extractor: string) {
  return `/api/snapshots/${snapshotId}/archives/${extractor}/download`;
}

function parseReadability(content: string | null): ReadabilityContent | null {
  if (!content) return null;
  try {
    return JSON.parse(content) as ReadabilityContent;
  } catch {
    return null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getExtractorResult(
  results: ArchiveResult[],
  extractor: string,
): ArchiveResult | undefined {
  return results.find((r) => r.extractor === extractor);
}

// ─── Tab label + icon map ─────────────────────────────────────

const TABS: { id: TabId; label: string; Icon: React.ElementType }[] = [
  { id: "reader", label: "Reader", Icon: BookOpen },
  { id: "screenshot", label: "Screenshot", Icon: Camera },
  { id: "dom", label: "DOM", Icon: Monitor },
  { id: "media", label: "Media", Icon: Film },
  { id: "raw", label: "Raw", Icon: Download },
  { id: "history", label: "History", Icon: History },
];

// ─── Empty / error state for a tab ───────────────────────────

function TabEmpty({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 h-full py-16 text-center"
      style={{ color: "var(--text-mid)" }}
    >
      <p className="text-ui-sm">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-ui-xs cursor-pointer"
          style={{
            background: "transparent",
            borderColor: "var(--border-default)",
            color: "var(--text-mid)",
          }}
        >
          <RefreshCcw size={12} />
          Retry
        </button>
      )}
    </div>
  );
}

// ─── Reader tab ───────────────────────────────────────────────

function ReaderTab({ result }: { result: ArchiveResult | undefined }) {
  if (!result?.content) {
    return <TabEmpty message="Readability extractor has no content for this snapshot." />;
  }
  const parsed = parseReadability(result.content);
  if (!parsed) {
    return <TabEmpty message="Could not parse readability content." />;
  }
  return (
    <div className="p-5 overflow-y-auto h-full">
      {parsed.title && (
        <h2
          className="text-ui-xl font-semibold mb-1 leading-snug"
          style={{ color: "var(--text-high)" }}
        >
          {parsed.title}
        </h2>
      )}
      {parsed.byline && (
        <p className="text-ui-xs mb-4" style={{ color: "var(--text-mid)" }}>
          {parsed.byline}
        </p>
      )}
      {parsed.content ? (
        <div
          className="text-ui-sm text-content prose-like"
          style={{ color: "var(--text-high)" }}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: readability HTML is from our own extractor
          dangerouslySetInnerHTML={{ __html: parsed.content }}
        />
      ) : parsed.excerpt ? (
        <p className="text-ui-sm text-content" style={{ color: "var(--text-high)" }}>
          {parsed.excerpt}
        </p>
      ) : (
        <TabEmpty message="No readable content extracted." />
      )}
    </div>
  );
}

// ─── Screenshot tab ───────────────────────────────────────────

function ScreenshotTab({
  snapshotId,
  result,
}: {
  snapshotId: number;
  result: ArchiveResult | undefined;
}) {
  const [zoom, setZoom] = useState(1);

  if (!result) {
    return <TabEmpty message="Screenshot extractor did not run or failed." />;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Zoom controls */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b shrink-0"
        style={{ borderColor: "var(--border-default)" }}
      >
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
          className="p-1 rounded border-0 cursor-pointer"
          style={{ background: "transparent", color: "var(--text-mid)" }}
        >
          <ZoomOut size={14} />
        </button>
        <span
          className="text-ui-xs tabular-nums"
          style={{ color: "var(--text-mid)", width: 40, textAlign: "center" }}
        >
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
          className="p-1 rounded border-0 cursor-pointer"
          style={{ background: "transparent", color: "var(--text-mid)" }}
        >
          <ZoomIn size={14} />
        </button>
        <a
          href={archiveUrl(snapshotId, "screenshot")}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-ui-xs no-underline"
          style={{ color: "var(--text-mid)" }}
        >
          <Download size={12} /> Download
        </a>
      </div>
      <div className="flex-1 overflow-auto p-4" style={{ background: "var(--bg-overlay)" }}>
        <img
          src={archiveUrl(snapshotId, "screenshot")}
          alt="Page screenshot"
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "top left",
            display: "block",
            maxWidth: "none",
          }}
        />
      </div>
    </div>
  );
}

// ─── DOM/SingleFile tab ───────────────────────────────────────

function DomTab({
  snapshotId,
  results,
}: {
  snapshotId: number;
  results: ArchiveResult[];
}) {
  const domResult = getExtractorResult(results, "dom-snapshot");
  const singlefileResult = getExtractorResult(results, "singlefile");
  const available = domResult || singlefileResult;
  const extractor = domResult ? "dom-snapshot" : "singlefile";

  if (!available) {
    return <TabEmpty message="DOM snapshot / SingleFile extractor did not run or failed." />;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div
        className="flex items-center justify-end px-3 py-2 border-b shrink-0 gap-2"
        style={{ borderColor: "var(--border-default)" }}
      >
        <a
          href={archiveUrl(snapshotId, extractor)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-ui-xs no-underline"
          style={{ color: "var(--text-mid)" }}
        >
          <Download size={12} /> Download
        </a>
      </div>
      <iframe
        src={archiveUrl(snapshotId, extractor)}
        title="DOM preview"
        sandbox="allow-same-origin allow-scripts"
        className="flex-1 border-0 w-full"
        style={{ background: "#fff" }}
      />
    </div>
  );
}

// ─── Media tab ────────────────────────────────────────────────

function MediaTab({
  snapshotId,
  results,
}: {
  snapshotId: number;
  results: ArchiveResult[];
}) {
  const mediaResult = getExtractorResult(results, "media");
  const metaResult = getExtractorResult(results, "media-metadata");

  if (!mediaResult) {
    return <TabEmpty message="Media extractor did not run or no media found." />;
  }

  let metadata: Record<string, unknown> | null = null;
  if (metaResult?.content) {
    try {
      metadata = JSON.parse(metaResult.content) as Record<string, unknown>;
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex flex-col gap-4 p-5 overflow-y-auto h-full">
      <video
        controls
        src={archiveUrl(snapshotId, "media")}
        className="w-full rounded"
        style={{ background: "#000" }}
      >
        <track kind="captions" />
        Your browser does not support video playback.
      </video>
      {metadata && (
        <div
          className="rounded-lg border overflow-hidden text-ui-xs"
          style={{ borderColor: "var(--border-default)" }}
        >
          {(["title", "uploader", "duration", "view_count", "description"] as const).map((k) => {
            const val = metadata?.[k];
            if (val == null) return null;
            return (
              <div
                key={k}
                className="flex gap-3 px-3 py-2 border-b last:border-b-0"
                style={{ borderColor: "var(--border-default)" }}
              >
                <span
                  className="capitalize shrink-0"
                  style={{ color: "var(--text-mid)", width: 72 }}
                >
                  {k.replace(/_/g, " ")}
                </span>
                <span className="truncate" style={{ color: "var(--text-high)" }}>
                  {String(val)}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <a
        href={archiveUrl(snapshotId, "media")}
        download
        className="inline-flex items-center gap-1.5 text-ui-xs no-underline"
        style={{ color: "var(--accent)" }}
      >
        <Download size={12} /> Download media file
      </a>
    </div>
  );
}

// ─── Raw tab ─────────────────────────────────────────────────

function RawTab({
  snapshotId,
  results,
}: {
  snapshotId: number;
  results: ArchiveResult[];
}) {
  const DOWNLOADABLE = [
    { extractor: "html", label: "HTML", icon: "html" },
    { extractor: "warc", label: "WARC", icon: "warc" },
    { extractor: "pdf", label: "PDF", icon: "pdf" },
    { extractor: "singlefile", label: "SingleFile HTML", icon: "singlefile" },
    { extractor: "dom-snapshot", label: "DOM Snapshot", icon: "dom-snapshot" },
  ];

  const available = DOWNLOADABLE.filter((d) => results.some((r) => r.extractor === d.extractor));

  if (available.length === 0) {
    return <TabEmpty message="No downloadable archive files for this snapshot." />;
  }

  return (
    <div className="flex flex-col gap-2 p-5">
      {available.map(({ extractor, label }) => (
        <a
          key={extractor}
          href={archiveUrl(snapshotId, extractor)}
          download
          className="flex items-center justify-between px-4 py-3 rounded-lg border no-underline transition-colors"
          style={{
            background: "var(--bg-overlay)",
            borderColor: "var(--border-default)",
            color: "var(--text-high)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = "var(--border-default)";
          }}
        >
          <span className="text-ui-sm font-medium">{label}</span>
          <Download size={14} style={{ color: "var(--text-mid)" }} />
        </a>
      ))}
    </div>
  );
}

// ─── History tab ─────────────────────────────────────────────

function HistoryTab({ results }: { results: ArchiveResult[] }) {
  if (results.length === 0) {
    return <TabEmpty message="No archive results yet." />;
  }

  const sorted = [...results].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <div
      className="flex flex-col divide-y overflow-y-auto h-full"
      style={{ borderColor: "var(--border-default)" }}
    >
      {sorted.map((r) => (
        <div key={r.id} className="flex items-center gap-3 px-4 py-3">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{
              background: r.content !== null ? "var(--status-success)" : "var(--status-danger)",
            }}
          />
          <div className="flex-1 min-w-0">
            <span className="text-ui-xs font-mono" style={{ color: "var(--text-high)" }}>
              {r.extractor}
            </span>
          </div>
          <span
            className="text-ui-xs shrink-0 flex items-center gap-1"
            style={{ color: "var(--text-low)" }}
          >
            <Clock size={10} />
            {new Date(r.createdAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Inline tag editor ────────────────────────────────────────

const snapshotTagKeys = {
  list: (snapshotId: number) => ["snapshot-tags", snapshotId] as const,
};

function InlineTags({ snapshotId }: { snapshotId: number }) {
  const client = useClient();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);

  const { data: tags = [] } = useQuery<Tag[]>({
    queryKey: snapshotTagKeys.list(snapshotId),
    queryFn: () => client.listSnapshotTags(snapshotId),
  });

  const { data: allTags = [] } = useQuery<Tag[]>({
    queryKey: tagKeys.list(),
    queryFn: () => client.listTags(),
  });

  const removeTag = useMutation({
    mutationFn: (tagId: number) => client.removeTagFromSnapshot(snapshotId, tagId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: snapshotTagKeys.list(snapshotId),
      }),
    onError: (e) => toast.error(e instanceof WebFrostError ? e.message : String(e)),
  });

  const addTag = useMutation({
    mutationFn: (tagId: number) => client.addTagToSnapshot(snapshotId, tagId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: snapshotTagKeys.list(snapshotId),
      });
      setShowAdd(false);
    },
    onError: (e) => toast.error(e instanceof WebFrostError ? e.message : String(e)),
  });

  function handleRemove(tagId: number) {
    removeTag.mutate(tagId);
  }

  function handleAdd(tagId: number) {
    addTag.mutate(tagId);
  }

  const available = allTags.filter((t) => !tags.some((st) => st.id === t.id));

  return (
    <div className="flex flex-wrap gap-1 items-center">
      {tags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-ui-xs border animate-chip-in"
          style={{
            background: tag.color ? `${tag.color}22` : "var(--bg-overlay)",
            color: tag.color ?? "var(--text-mid)",
            borderColor: tag.color ? `${tag.color}44` : "var(--border-default)",
          }}
        >
          {tag.name}
          <button
            type="button"
            onClick={() => handleRemove(tag.id)}
            className="border-0 cursor-pointer p-0 leading-none"
            style={{
              background: "transparent",
              color: "inherit",
              opacity: 0.6,
            }}
            aria-label={`Remove tag ${tag.name}`}
          >
            ×
          </button>
        </span>
      ))}
      {available.length > 0 &&
        (showAdd ? (
          <select
            className="px-1.5 py-0.5 rounded border text-ui-xs cursor-pointer"
            style={{
              background: "var(--bg-overlay)",
              borderColor: "var(--border-default)",
              color: "var(--text-high)",
            }}
            value=""
            onChange={(e) => {
              const id = Number(e.target.value);
              if (id) handleAdd(id);
            }}
            onBlur={() => setShowAdd(false)}
          >
            <option value="">Pick tag…</option>
            {available.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center p-0.5 rounded border-0 cursor-pointer"
            style={{ background: "transparent", color: "var(--text-low)" }}
            aria-label="Add tag"
          >
            <Plus size={11} />
          </button>
        ))}
      {tags.length === 0 && !showAdd && (
        <span className="text-ui-xs" style={{ color: "var(--text-low)" }}>
          No tags
        </span>
      )}
    </div>
  );
}

// ─── Metadata sidebar ─────────────────────────────────────────

function MetadataSidebar({
  detail,
  onDelete,
}: {
  detail: SnapshotDetail;
  onDelete: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function copyUrl() {
    navigator.clipboard.writeText(detail.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const isDone = detail.status === "done";

  return (
    <div
      className="flex flex-col gap-4 overflow-y-auto p-3 border-l"
      style={{
        width: 180,
        minWidth: 180,
        borderColor: "var(--border-default)",
        background: "var(--bg-surface)",
      }}
    >
      {/* URL */}
      <div>
        <p className="text-ui-xs mb-1 font-medium" style={{ color: "var(--text-low)" }}>
          URL
        </p>
        <div className="flex items-start gap-1">
          <a
            href={detail.url}
            target="_blank"
            rel="noreferrer"
            className="text-ui-xs font-mono break-all no-underline line-clamp-3"
            style={{ color: "var(--accent)" }}
          >
            {detail.url}
          </a>
          <button
            type="button"
            onClick={copyUrl}
            className="shrink-0 p-0.5 rounded border-0 cursor-pointer"
            style={{ background: "transparent", color: "var(--text-low)" }}
            title="Copy URL"
          >
            <Copy size={11} />
          </button>
        </div>
        {copied && (
          <span className="text-ui-xs" style={{ color: "var(--status-success)" }}>
            Copied!
          </span>
        )}
      </div>

      {/* Status */}
      <div>
        <p className="text-ui-xs mb-1 font-medium" style={{ color: "var(--text-low)" }}>
          Status
        </p>
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded text-ui-xs font-medium border"
          style={{
            background: isDone
              ? "color-mix(in srgb, var(--status-success) 12%, transparent)"
              : "color-mix(in srgb, var(--status-warning) 12%, transparent)",
            color: isDone ? "var(--status-success)" : "var(--status-warning)",
            borderColor: isDone
              ? "color-mix(in srgb, var(--status-success) 25%, transparent)"
              : "color-mix(in srgb, var(--status-warning) 25%, transparent)",
          }}
        >
          {detail.status}
        </span>
      </div>

      {/* Created */}
      <div>
        <p className="text-ui-xs mb-1 font-medium" style={{ color: "var(--text-low)" }}>
          Captured
        </p>
        <span className="text-ui-xs flex items-center gap-1" style={{ color: "var(--text-mid)" }}>
          <Clock size={10} />
          {new Date(detail.createdAt).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>

      {/* Tags */}
      <div>
        <p
          className="text-ui-xs mb-1.5 font-medium flex items-center gap-1"
          style={{ color: "var(--text-low)" }}
        >
          <TagIcon size={10} />
          Tags
        </p>
        <InlineTags snapshotId={detail.id} />
      </div>

      {/* Extractors */}
      <div>
        <p className="text-ui-xs mb-1.5 font-medium" style={{ color: "var(--text-low)" }}>
          Extractors
        </p>
        <div className="flex flex-col gap-1">
          {detail.archiveResults.length === 0 ? (
            <span className="text-ui-xs" style={{ color: "var(--text-low)" }}>
              None yet
            </span>
          ) : (
            detail.archiveResults.map((r) => (
              <div key={r.id} className="flex items-center gap-1.5">
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{
                    background:
                      r.content !== null ? "var(--status-success)" : "var(--status-danger)",
                  }}
                />
                <span
                  className="text-ui-xs font-mono truncate"
                  style={{ color: "var(--text-mid)" }}
                >
                  {r.extractor}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Storage (placeholder — depends on WEB-137) */}
      <div className="mt-auto pt-3" style={{ borderTop: "1px solid var(--border-default)" }}>
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center gap-1.5 text-ui-xs cursor-pointer border-0 p-0"
          style={{ background: "transparent", color: "var(--status-danger)" }}
        >
          <Trash2 size={11} />
          Delete
        </button>
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────

interface SnapshotDetailPanelProps {
  snapshotId: number;
  onClose: () => void;
  onDelete: () => Promise<void>;
}

export function SnapshotDetailPanel({ snapshotId, onClose, onDelete }: SnapshotDetailPanelProps) {
  const client = useClient();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>("reader");

  const {
    data: detail,
    isPending: loading,
    error: queryError,
  } = useQuery<SnapshotDetail | null>({
    queryKey: snapshotKeys.detail(snapshotId),
    queryFn: () => client.getSnapshot(snapshotId),
  });

  const error = queryError ? String(queryError) : detail === null ? "Snapshot not found." : null;

  const deleteMutation = useMutation({
    mutationFn: () => client.deleteSnapshot(snapshotId),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: snapshotKeys.all });
      toast.success("Snapshot deleted");
      await onDelete();
    },
    onError: (e) => toast.error(e instanceof WebFrostError ? e.message : String(e)),
  });

  const deleting = deleteMutation.isPending;

  // Panel open/close animation state
  const [visible, setVisible] = useState(false);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Animate in on mount
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  function handleClose() {
    setVisible(false);
    closeTimeoutRef.current = setTimeout(onClose, 160);
  }

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: handleClose is defined in same render, stable enough
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  function handleDelete() {
    if (!window.confirm("Delete this snapshot and all its artifacts? This cannot be undone."))
      return;
    deleteMutation.mutate();
  }

  // Select appropriate default tab based on available extractors
  useEffect(() => {
    if (!detail) return;
    const extractors = new Set(detail.archiveResults.map((r) => r.extractor));
    if (extractors.has("readability")) setActiveTab("reader");
    else if (extractors.has("screenshot")) setActiveTab("screenshot");
    else if (extractors.size > 0) setActiveTab("raw");
  }, [detail]);

  return (
    <>
      {/* Semi-transparent backdrop (pointer-events: none = list stays interactive) */}
      <div
        className="fixed inset-0 z-40"
        style={{
          background: "rgba(0,0,0,0.3)",
          pointerEvents: "none",
          opacity: visible ? 1 : 0,
          transition: "opacity 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      />

      {/* Click-to-close overlay (pointer-events: all, but only covers non-panel area) */}
      <div
        className="fixed inset-0 z-40"
        style={{ pointerEvents: "all" }}
        onClick={handleClose}
        onKeyDown={(e) => {
          if (e.key === "Escape") handleClose();
        }}
        role="presentation"
      />

      {/* Panel */}
      <div
        className="fixed top-0 right-0 bottom-0 z-50 flex flex-col"
        style={{
          width: 640,
          maxWidth: "90vw",
          background: "var(--bg-surface)",
          borderLeft: "1px solid var(--border-default)",
          boxShadow: "-12px 0 40px rgba(0,0,0,0.25)",
          transform: visible ? "translateX(0)" : "translateX(100%)",
          transition: visible
            ? "transform 200ms cubic-bezier(0.16, 1, 0.3, 1)"
            : "transform 150ms cubic-bezier(0.4, 0, 1, 1)",
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* Panel header */}
        <div
          className="flex items-center justify-between px-4 py-2.5 border-b shrink-0"
          style={{ borderColor: "var(--border-default)" }}
        >
          <div className="flex items-center gap-2">
            <span className="text-ui-sm font-semibold" style={{ color: "var(--text-high)" }}>
              {detail?.title ?? "Snapshot Detail"}
            </span>
            {detail && (
              <span
                className="text-ui-xs font-mono truncate max-w-[200px]"
                style={{ color: "var(--text-mid)" }}
              >
                #{detail.id}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded border-0 cursor-pointer transition-colors"
            style={{ background: "transparent", color: "var(--text-mid)" }}
            aria-label="Close panel"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs row */}
        <div
          className="flex border-b shrink-0 overflow-x-auto"
          style={{ borderColor: "var(--border-default)" }}
        >
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className="flex items-center gap-1.5 px-3 py-2.5 text-ui-xs border-b-2 cursor-pointer border-0 whitespace-nowrap transition-colors"
              style={{
                background: "transparent",
                color: activeTab === id ? "var(--accent)" : "var(--text-mid)",
                borderBottomColor: activeTab === id ? "var(--accent)" : "transparent",
                fontWeight: activeTab === id ? 500 : 400,
              }}
            >
              <Icon size={12} />
              {label}
            </button>
          ))}
        </div>

        {/* Content area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Tab content */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {loading && (
              <div className="flex flex-col gap-3 p-5">
                {[80, 60, 100, 40, 70].map((w, i) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: skeleton items
                    key={i}
                    className="rounded animate-pulse"
                    style={{
                      height: i === 0 ? 16 : 10,
                      width: `${w}%`,
                      background: "var(--bg-overlay)",
                    }}
                  />
                ))}
              </div>
            )}

            {error && (
              <div className="p-5">
                <div
                  className="px-3 py-2 rounded border text-ui-sm"
                  style={{
                    background: "color-mix(in srgb, var(--status-danger) 10%, transparent)",
                    borderColor: "color-mix(in srgb, var(--status-danger) 25%, transparent)",
                    color: "var(--status-danger)",
                  }}
                >
                  {error}
                </div>
              </div>
            )}

            {detail && !loading && (
              <>
                {activeTab === "reader" && (
                  <ReaderTab result={getExtractorResult(detail.archiveResults, "readability")} />
                )}
                {activeTab === "screenshot" && (
                  <ScreenshotTab
                    snapshotId={detail.id}
                    result={getExtractorResult(detail.archiveResults, "screenshot")}
                  />
                )}
                {activeTab === "dom" && (
                  <DomTab snapshotId={detail.id} results={detail.archiveResults} />
                )}
                {activeTab === "media" && (
                  <MediaTab snapshotId={detail.id} results={detail.archiveResults} />
                )}
                {activeTab === "raw" && (
                  <RawTab snapshotId={detail.id} results={detail.archiveResults} />
                )}
                {activeTab === "history" && <HistoryTab results={detail.archiveResults} />}
              </>
            )}
          </div>

          {/* Metadata sidebar */}
          {detail && (
            <MetadataSidebar
              detail={detail}
              onDelete={() => {
                if (!deleting) handleDelete();
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}
