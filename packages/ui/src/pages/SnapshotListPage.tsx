import { WebFrostError } from "@webfrost/sdk";
import type { Snapshot, Tag } from "@webfrost/sdk";
import {
  AlignJustify,
  Camera,
  ChevronDown,
  Clock,
  LayoutList,
  Plus,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Pagination } from "../components/Pagination";
import { useClient } from "../context";
import { useBulkSnapshots, useSnapshots, useTags } from "../hooks";
import { SnapshotDetailPanel } from "./SnapshotDetailPanel";

// ─── Constants ────────────────────────────────────────────────

const DENSITY_KEY = "webfrost-snapshot-density";
const PAGE_SIZE = 20;
const KNOWN_EXTRACTORS = [
  "screenshot",
  "warc",
  "html",
  "pdf",
  "readability",
  "dom-snapshot",
  "singlefile",
  "media",
];

// ─── Types ────────────────────────────────────────────────────

type Density = "comfortable" | "compact";

const ROW_HEIGHT: Record<Density, number> = {
  comfortable: 56,
  compact: 36,
};

// ─── Extractor chip ───────────────────────────────────────────

function ExtractorChip({ name, active }: { name: string; active: boolean }) {
  const short = name.slice(0, 3).toUpperCase();
  return (
    <span
      title={name}
      className="inline-flex items-center px-1.5 rounded text-ui-xs font-mono font-medium border"
      style={{
        background: active
          ? "color-mix(in srgb, var(--status-success) 12%, transparent)"
          : "color-mix(in srgb, var(--status-danger) 10%, transparent)",
        color: active ? "var(--status-success)" : "var(--status-danger)",
        borderColor: active
          ? "color-mix(in srgb, var(--status-success) 25%, transparent)"
          : "color-mix(in srgb, var(--status-danger) 20%, transparent)",
      }}
    >
      {short}
    </span>
  );
}

// ─── Status chip ──────────────────────────────────────────────

function StatusChip({ status }: { status: string }) {
  const isDone = status === "done";
  const isFailed = status === "failed";
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-ui-xs font-medium border whitespace-nowrap"
      style={{
        background: isDone
          ? "color-mix(in srgb, var(--status-success) 12%, transparent)"
          : isFailed
            ? "color-mix(in srgb, var(--status-danger) 12%, transparent)"
            : "color-mix(in srgb, var(--status-warning) 12%, transparent)",
        color: isDone
          ? "var(--status-success)"
          : isFailed
            ? "var(--status-danger)"
            : "var(--status-warning)",
        borderColor: isDone
          ? "color-mix(in srgb, var(--status-success) 25%, transparent)"
          : isFailed
            ? "color-mix(in srgb, var(--status-danger) 20%, transparent)"
            : "color-mix(in srgb, var(--status-warning) 20%, transparent)",
      }}
    >
      {status}
    </span>
  );
}

// ─── Snapshot row ─────────────────────────────────────────────

interface SnapshotRowProps {
  snapshot: Snapshot;
  selected: boolean;
  onToggle: (id: number) => void;
  density: Density;
  height: number;
  style?: CSSProperties;
}

function SnapshotRow({ snapshot, selected, onToggle, density, height, style }: SnapshotRowProps) {
  const ts = new Date(snapshot.createdAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const extractorSet = new Set(snapshot.extractors);

  return (
    <li
      style={{
        ...style,
        height,
        display: "flex",
        alignItems: "center",
        borderBottom: "1px solid var(--border-default)",
        background: selected ? "color-mix(in srgb, var(--accent) 6%, transparent)" : "transparent",
        transition: "background 100ms ease",
        listStyle: "none",
      }}
      onMouseEnter={(e) => {
        if (!selected) (e.currentTarget as HTMLElement).style.background = "var(--bg-subtle)";
      }}
      onMouseLeave={(e) => {
        if (!selected) (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      {/* Checkbox */}
      <label
        className="flex items-center justify-center shrink-0 cursor-pointer"
        style={{ width: 40, height: "100%" }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(snapshot.id)}
          className="cursor-pointer"
          aria-label={`Select ${snapshot.url}`}
          style={{ accentColor: "var(--accent)" }}
        />
      </label>

      {/* Thumbnail */}
      {density === "comfortable" && (
        <div
          className="shrink-0 rounded overflow-hidden mr-3"
          style={{
            width: 56,
            height: 40,
            background: "var(--bg-overlay)",
            border: "1px solid var(--border-default)",
          }}
        >
          {snapshot.screenshotUrl ? (
            <img
              src={snapshot.screenshotUrl}
              alt=""
              loading="lazy"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center"
              style={{ color: "var(--text-low)" }}
            >
              <Camera size={14} />
            </div>
          )}
        </div>
      )}

      {/* URL + title (main content) — rendered as a link for accessibility and test targeting */}
      <Link
        to={`?detail=${snapshot.id}`}
        className="flex-1 min-w-0 flex flex-col justify-center text-left no-underline pr-3"
        style={{ height: "100%", color: "inherit" }}
      >
        {density === "comfortable" && snapshot.title ? (
          <>
            <span className="text-ui-sm font-medium truncate" style={{ color: "var(--text-high)" }}>
              {snapshot.title}
            </span>
            <span className="text-ui-xs font-mono truncate" style={{ color: "var(--text-mid)" }}>
              {snapshot.url}
            </span>
          </>
        ) : (
          <span className="text-ui-sm font-mono truncate" style={{ color: "var(--text-high)" }}>
            {snapshot.url}
          </span>
        )}
      </Link>

      {/* Extractor chips */}
      <div className="hidden md:flex items-center gap-1 shrink-0 mr-3">
        {KNOWN_EXTRACTORS.filter((e) => e !== "screenshot" && e !== "html").map((ext) => (
          <ExtractorChip key={ext} name={ext} active={extractorSet.has(ext)} />
        ))}
      </div>

      {/* Tags */}
      {density === "comfortable" && snapshot.tags.length > 0 && (
        <div className="hidden lg:flex items-center gap-1 shrink-0 mr-3 max-w-[120px] overflow-hidden">
          {snapshot.tags.slice(0, 2).map((tag) => (
            <span
              key={tag.id}
              className="text-ui-xs px-1.5 py-0.5 rounded truncate"
              style={{
                background: tag.color ? `${tag.color}22` : "var(--bg-overlay)",
                color: tag.color ?? "var(--text-mid)",
                border: `1px solid ${tag.color ? `${tag.color}44` : "var(--border-default)"}`,
              }}
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}

      {/* Status */}
      <div className="shrink-0 mr-3" style={{ width: 72 }}>
        <StatusChip status={snapshot.status} />
      </div>

      {/* Timestamp */}
      <div
        className="shrink-0 flex items-center gap-1 text-ui-xs mr-3"
        style={{ color: "var(--text-low)", width: 100, justifyContent: "flex-end" }}
      >
        <Clock size={10} />
        <span className="truncate">{ts}</span>
      </div>
    </li>
  );
}

// ─── New Snapshot Dropdown ─────────────────────────────────────

function NewSnapshotDropdown({
  onArchiveUrl,
  submitting,
}: {
  onArchiveUrl: (url: string) => void;
  submitting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    onArchiveUrl(url);
    setUrl("");
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-ui-sm font-medium cursor-pointer transition-colors"
        style={{
          background: "var(--accent)",
          color: "var(--accent-fg)",
          borderColor: "transparent",
        }}
      >
        <Plus size={14} />
        New Snapshot
        <ChevronDown size={12} style={{ opacity: 0.7 }} />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
            role="presentation"
          />
          <div
            className="absolute right-0 top-full mt-1 rounded-lg border shadow-xl z-20 p-3"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--border-default)",
              width: 360,
            }}
          >
            <p className="text-ui-xs mb-2" style={{ color: "var(--text-mid)" }}>
              Archive a URL
            </p>
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                ref={inputRef}
                type="url"
                placeholder="https://example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                className="flex-1 px-3 py-1.5 rounded border text-ui-sm font-mono"
                style={{
                  background: "var(--bg-overlay)",
                  borderColor: "var(--border-default)",
                  color: "var(--text-high)",
                  outline: "none",
                }}
              />
              <button
                type="submit"
                disabled={submitting}
                className="px-3 py-1.5 rounded border-0 text-ui-sm font-medium cursor-pointer disabled:opacity-50"
                style={{
                  background: "var(--accent)",
                  color: "var(--accent-fg)",
                }}
              >
                {submitting ? "…" : "Archive"}
              </button>
            </form>
            <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--border-default)" }}>
              <Link
                to="/import"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-2 py-1.5 rounded text-ui-sm no-underline transition-colors"
                style={{ color: "var(--text-mid)" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)";
                  (e.currentTarget as HTMLElement).style.color = "var(--text-high)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                  (e.currentTarget as HTMLElement).style.color = "var(--text-mid)";
                }}
              >
                <Upload size={13} />
                Import from RSS / Bookmarks
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Bulk action bar ──────────────────────────────────────────

function BulkBar({
  count,
  status,
  allTags,
  onDelete,
  onTag,
  onClear,
}: {
  count: number;
  status: string | null;
  allTags: Tag[];
  onDelete: () => void;
  onTag: (tagId: number) => void;
  onClear: () => void;
}) {
  const busy = status !== null;
  return (
    <div
      className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-xl shadow-2xl text-ui-sm"
      style={{
        background: "var(--bg-overlay)",
        border: "1px solid var(--border-strong)",
        color: "var(--text-high)",
      }}
    >
      <span className="font-medium" style={{ color: "var(--text-mid)" }}>
        {status ?? `${count} selected`}
      </span>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded border-0 cursor-pointer disabled:opacity-50 font-medium text-ui-xs"
        style={{ background: "var(--status-danger)", color: "#fff" }}
      >
        <Trash2 size={12} />
        Delete
      </button>
      {allTags.length > 0 && (
        <select
          disabled={busy}
          className="px-2 py-1 rounded text-ui-xs cursor-pointer disabled:opacity-50 border"
          style={{
            background: "var(--bg-surface)",
            color: "var(--text-high)",
            borderColor: "var(--border-default)",
          }}
          value=""
          onChange={(e) => {
            const id = Number(e.target.value);
            if (id) onTag(id);
          }}
        >
          <option value="">Tag…</option>
          {allTags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={onClear}
        className="p-1 rounded border-0 cursor-pointer"
        style={{ background: "transparent", color: "var(--text-mid)" }}
        aria-label="Clear selection"
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────

export function SnapshotListPage() {
  const client = useClient();
  const [page, setPage] = useState(1);
  const {
    snapshots,
    total,
    loading,
    error: snapshotsError,
    setError,
    refetch,
  } = useSnapshots(page, PAGE_SIZE);
  const { tags: allTags } = useTags();
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const [searchParams, setSearchParams] = useSearchParams();
  const detailId = searchParams.get("detail") ? Number(searchParams.get("detail")) : null;

  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [density, setDensity] = useState<Density>(() => {
    try {
      const stored = localStorage.getItem(DENSITY_KEY);
      return stored === "compact" ? "compact" : "comfortable";
    } catch {
      return "comfortable";
    }
  });

  // Client-side search filters within the current page
  const filtered = useMemo(() => {
    if (!search.trim()) return snapshots;
    const q = search.toLowerCase();
    return snapshots.filter(
      (s) => s.url.toLowerCase().includes(q) || s.title?.toLowerCase().includes(q),
    );
  }, [snapshots, search]);

  const bulk = useBulkSnapshots(
    filtered.map((s) => s.id),
    refetch,
  );

  useEffect(() => {
    if (snapshotsError) {
      toast.error(snapshotsError);
      setError(null);
    }
  }, [snapshotsError, setError]);

  function setDensityAndPersist(d: Density) {
    setDensity(d);
    try {
      localStorage.setItem(DENSITY_KEY, d);
    } catch {}
  }

  async function handleArchiveUrl(url: string) {
    setSubmitting(true);
    try {
      await client.createSnapshot(url);
      await refetch();
      toast.success("Snapshot queued");
    } catch (e) {
      toast.error(e instanceof WebFrostError ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  function openDetail(id: number) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("detail", String(id));
      return next;
    });
  }

  function closeDetail() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("detail");
      return next;
    });
  }

  const rowHeight = ROW_HEIGHT[density];
  const skeletonCount = 10;

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "var(--bg-app)" }}>
      {/* ── Header ─────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-5 py-3 border-b shrink-0"
        style={{ borderColor: "var(--border-default)" }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-ui-lg font-semibold m-0" style={{ color: "var(--text-high)" }}>
            Snapshots
          </h1>
          {!loading && (
            <span
              className="text-ui-xs px-1.5 py-0.5 rounded"
              style={{
                background: "var(--bg-overlay)",
                color: "var(--text-mid)",
              }}
            >
              {search.trim() ? filtered.length : total}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <input
            type="search"
            placeholder="Filter by URL or title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-1.5 rounded border text-ui-sm"
            style={{
              background: "var(--bg-overlay)",
              borderColor: "var(--border-default)",
              color: "var(--text-high)",
              width: 220,
              outline: "none",
            }}
          />

          {/* Density toggle */}
          <div
            className="flex rounded border overflow-hidden"
            style={{ borderColor: "var(--border-default)" }}
          >
            {(["comfortable", "compact"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDensityAndPersist(d)}
                title={d}
                className="flex items-center justify-center p-1.5 cursor-pointer border-0 transition-colors"
                style={{
                  background: density === d ? "var(--bg-overlay)" : "transparent",
                  color: density === d ? "var(--text-high)" : "var(--text-low)",
                }}
              >
                {d === "comfortable" ? <AlignJustify size={14} /> : <LayoutList size={14} />}
              </button>
            ))}
          </div>

          <NewSnapshotDropdown onArchiveUrl={handleArchiveUrl} submitting={submitting} />
        </div>
      </div>

      {/* ── Table header ────────────────────────────────────── */}
      <div
        className="flex items-center shrink-0 px-0 border-b text-ui-xs"
        style={{
          height: 32,
          borderColor: "var(--border-default)",
          color: "var(--text-low)",
          background: "var(--bg-surface)",
        }}
      >
        {/* Checkbox + select all */}
        <div style={{ width: 40 }} className="flex items-center justify-center">
          <input
            type="checkbox"
            checked={bulk.allSelected}
            onChange={bulk.toggleAll}
            className="cursor-pointer"
            aria-label="Select all"
            style={{ accentColor: "var(--accent)" }}
          />
        </div>
        {density === "comfortable" && <div style={{ width: 56 + 12 }} className="shrink-0" />}
        <div className="flex-1 px-2">URL</div>
        <div className="hidden md:block shrink-0 mr-3" style={{ width: 168 }}>
          Extractors
        </div>
        <div className="shrink-0 mr-3" style={{ width: 72 }}>
          Status
        </div>
        <div className="shrink-0 mr-3 text-right" style={{ width: 100 }}>
          Captured
        </div>
      </div>

      {/* ── List ─────────────────────────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden"
        style={{ background: "var(--bg-app)" }}
      >
        {loading ? (
          // Skeleton rows — rendered as <li> without child <a> so tests can
          // distinguish them from real data rows via the "li a" selector.
          <ul style={{ margin: 0, padding: 0 }}>
            {Array.from({ length: skeletonCount }).map((_, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton rows
                key={i}
                className="flex items-center gap-3 px-5 border-b"
                style={{
                  height: rowHeight,
                  borderColor: "var(--border-default)",
                  listStyle: "none",
                }}
              >
                <div
                  className="rounded animate-pulse"
                  style={{ width: 12, height: 12, background: "var(--bg-overlay)" }}
                />
                {density === "comfortable" && (
                  <div
                    className="rounded animate-pulse"
                    style={{ width: 56, height: 40, background: "var(--bg-overlay)" }}
                  />
                )}
                <div className="flex-1 flex flex-col gap-1.5">
                  <div
                    className="rounded animate-pulse"
                    style={{ width: "60%", height: 10, background: "var(--bg-overlay)" }}
                  />
                  {density === "comfortable" && (
                    <div
                      className="rounded animate-pulse"
                      style={{ width: "40%", height: 8, background: "var(--bg-overlay)" }}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : filtered.length === 0 ? (
          // Empty state
          <div
            className="flex flex-col items-center justify-center gap-4 py-24"
            style={{ color: "var(--text-mid)" }}
          >
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{ background: "var(--bg-overlay)" }}
            >
              {snapshots.length === 0 ? (
                <Camera size={24} style={{ color: "var(--text-low)" }} />
              ) : (
                <SlidersHorizontal size={24} style={{ color: "var(--text-low)" }} />
              )}
            </div>
            <div className="text-center">
              <p className="text-ui-base font-medium" style={{ color: "var(--text-high)" }}>
                {snapshots.length === 0 ? "No snapshots yet" : "No results match your filter"}
              </p>
              <p className="text-ui-sm mt-1" style={{ color: "var(--text-mid)" }}>
                {snapshots.length === 0
                  ? "Use the New Snapshot button to archive your first URL."
                  : "Try a different search term."}
              </p>
            </div>
          </div>
        ) : (
          // Paginated rows — <ul> > <li> > <Link> structure
          <ul style={{ margin: 0, padding: 0 }}>
            {filtered.map((snapshot) => (
              <SnapshotRow
                key={snapshot.id}
                snapshot={snapshot}
                selected={bulk.selectedIds.has(snapshot.id)}
                onToggle={bulk.toggle}
                density={density}
                height={rowHeight}
              />
            ))}
          </ul>
        )}

        {/* ── Pagination ────────────────────────────────────── */}
        {!loading && totalPages > 1 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
            onPage={setPage}
          />
        )}
      </div>

      {/* ── Bulk action bar ───────────────────────────────────── */}
      {bulk.someSelected && (
        <BulkBar
          count={bulk.selectedIds.size}
          status={bulk.status}
          allTags={allTags}
          onDelete={bulk.bulkDelete}
          onTag={bulk.bulkTag}
          onClear={bulk.clearSelection}
        />
      )}

      {/* ── Detail slide-in panel ─────────────────────────────── */}
      {detailId !== null && (
        <SnapshotDetailPanel
          snapshotId={detailId}
          onClose={closeDetail}
          onDelete={async () => {
            await refetch();
            closeDetail();
          }}
        />
      )}
    </div>
  );
}
