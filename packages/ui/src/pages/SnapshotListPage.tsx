import { AlignJustify, LayoutGrid, LayoutList, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Pagination } from "../components/Pagination";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/StateViews";
import { useAuth } from "../context/auth";
import { BulkBar } from "../features/snapshots/BulkBar";
import { NewSnapshotMenu } from "../features/snapshots/NewSnapshotMenu";
import {
  type Density,
  SnapshotCard,
  SnapshotCardSkeleton,
  SnapshotRow,
  SnapshotRowSkeleton,
} from "../features/snapshots/SnapshotRow";
import { useBulkSnapshots } from "../hooks/useBulkSnapshots";
import { useCreateSnapshot, useSnapshots } from "../hooks/useSnapshots";
import { useTags } from "../hooks/useTags";
import { STORAGE_KEYS, readStorage, writeStorage } from "../lib/storage";
import { parsePositiveInt } from "../lib/url";

const PAGE_SIZE = 20;

const LAYOUT_LABELS: Record<Density, string> = {
  grid: "Cards",
  comfortable: "Comfortable rows",
  compact: "Compact rows",
};

export function SnapshotListPage() {
  const { canWrite } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // ?detail=<id> is the old address of a snapshot: it goes to the viewer. A malformed id
  // (abc, 0, -1) simply opens nothing.
  const legacyDetailId = parsePositiveInt(searchParams.get("detail"));
  const page = parsePositiveInt(searchParams.get("page")) ?? 1;

  const { snapshots, total, loading, isError, error, refetch } = useSnapshots(page, PAGE_SIZE);
  const { tags: allTags } = useTags();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const [search, setSearch] = useState("");
  const [density, setDensity] = useState<Density>(() => {
    const saved = readStorage(STORAGE_KEYS.snapshotDensity);
    // Cards unless the browser remembers rows: an archive is browsed by sight first.
    return saved === "compact" || saved === "comfortable" ? saved : "grid";
  });

  // Client-side filter: it narrows the rows of the current page only.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return snapshots;
    return snapshots.filter(
      (s) => s.url.toLowerCase().includes(q) || s.title?.toLowerCase().includes(q),
    );
  }, [snapshots, search]);

  const bulk = useBulkSnapshots(
    filtered.map((s) => s.id),
    canWrite,
  );

  const archive = useCreateSnapshot();

  // A page past the end (the last rows were deleted, or a stale link) steps back to the last one.
  useEffect(() => {
    if (loading || isError || page <= totalPages) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (totalPages <= 1) next.delete("page");
        else next.set("page", String(totalPages));
        return next;
      },
      { replace: true },
    );
  }, [loading, isError, page, totalPages, setSearchParams]);

  function goToPage(p: number) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (p <= 1) next.delete("page");
      else next.set("page", String(p));
      return next;
    });
    bulk.clearSelection();
  }

  function setDensityAndPersist(d: Density) {
    setDensity(d);
    writeStorage(STORAGE_KEYS.snapshotDensity, d);
  }

  /** The list the viewer's Back returns to: this page, without the legacy ?detail=. */
  function listSearch(): string {
    const next = new URLSearchParams(searchParams);
    next.delete("detail");
    const s = next.toString();
    return s ? `?${s}` : "";
  }

  const rowTo = (id: number) => `/snapshots/${id}`;
  const rowState = { back: `/snapshots${listSearch()}` };

  const filtering = search.trim().length > 0;

  if (legacyDetailId !== null) return <Navigate to={`/snapshots/${legacyDetailId}`} replace />;

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col overflow-hidden bg-app lg:h-dvh">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex items-center gap-3">
          <h1 className="m-0 text-ui-xl font-semibold text-high">Snapshots</h1>
          {!loading && !isError && (
            <span
              className="rounded-full bg-overlay px-2 py-0.5 text-ui-xs font-semibold tabular-nums text-mid"
              title={filtering ? "Matches on this page" : "Total snapshots"}
            >
              {filtering ? filtered.length : total}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            data-page-search
            aria-label="Filter this page by URL or title"
            placeholder="Filter by URL or title…"
            title="Filters the snapshots on this page"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              bulk.clearSelection();
            }}
            className="field !w-full sm:!w-56"
          />

          <div
            role="group"
            aria-label="Layout"
            className="flex overflow-hidden rounded-md border border-border"
          >
            {(["grid", "comfortable", "compact"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDensityAndPersist(d)}
                title={LAYOUT_LABELS[d]}
                aria-label={LAYOUT_LABELS[d]}
                aria-pressed={density === d}
                className={`flex size-8 items-center justify-center border-0 transition-colors ${
                  density === d
                    ? "bg-overlay text-high"
                    : "bg-transparent text-low hover:bg-subtle hover:text-high"
                }`}
              >
                {d === "grid" ? (
                  <LayoutGrid size={15} aria-hidden="true" />
                ) : d === "comfortable" ? (
                  <AlignJustify size={15} aria-hidden="true" />
                ) : (
                  <LayoutList size={15} aria-hidden="true" />
                )}
              </button>
            ))}
          </div>

          {canWrite && (
            <NewSnapshotMenu
              onArchiveUrl={(url) => archive.mutate(url)}
              submitting={archive.isPending}
            />
          )}
        </div>
      </div>

      {/* Cards have no table header: select all sits in a slim bar of its own. */}
      {/* Shown while loading too (disabled), so the cards do not move down when the data arrives. */}
      {density === "grid" && canWrite && !isError && (loading || filtered.length > 0) && (
        <div className="flex h-9 shrink-0 items-center border-b border-border bg-surface px-4 sm:px-5">
          <label className="flex cursor-pointer items-center gap-2 text-ui-xs font-medium text-mid">
            <input
              type="checkbox"
              checked={bulk.allSelected}
              onChange={bulk.toggleAll}
              disabled={loading}
              aria-label="Select all"
              className="accent-accent"
            />
            Select all
          </label>
        </div>
      )}

      {/* ── Table header (rows only; cards carry their own labels) ── */}
      {density !== "grid" && (
        <div
          aria-hidden={loading || isError || filtered.length === 0 ? true : undefined}
          className="flex h-8 shrink-0 items-center border-b border-border bg-surface text-ui-xs font-medium text-mid"
        >
          <div className={`flex shrink-0 items-center justify-center ${canWrite ? "w-10" : "w-5"}`}>
            {canWrite && (
              <input
                type="checkbox"
                checked={bulk.allSelected}
                onChange={bulk.toggleAll}
                aria-label="Select all"
                className="accent-accent"
              />
            )}
          </div>
          {density === "comfortable" && <div className="mr-3 hidden w-14 shrink-0 sm:block" />}
          <div className="flex-1 px-2">URL</div>
          <div className="mr-3 hidden w-60 shrink-0 md:block">Extractors</div>
          <div className="mr-3 w-20 shrink-0 text-right md:w-[4.5rem] md:text-left">Status</div>
          <div className="mr-3 hidden w-28 shrink-0 text-right md:block">Captured</div>
        </div>
      )}

      {/* ── List ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {loading && density === "grid" ? (
          <ul
            className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4 p-4 sm:p-5"
            role="status"
            aria-label="Loading snapshots"
          >
            {Array.from({ length: 12 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
              <SnapshotCardSkeleton key={i} />
            ))}
          </ul>
        ) : loading ? (
          // Skeleton rows are <li> without a link, so they are never mistaken for data rows.
          <ul className="m-0 list-none p-0" role="status" aria-label="Loading snapshots">
            {Array.from({ length: 10 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
              <SnapshotRowSkeleton key={i} density={density} selectable={canWrite} index={i} />
            ))}
          </ul>
        ) : isError ? (
          <ErrorState title="Could not load snapshots" error={error} onRetry={() => refetch()} />
        ) : filtered.length === 0 ? (
          snapshots.length === 0 ? (
            <EmptyState mascot title="No snapshots yet">
              {canWrite
                ? "Use the New Snapshot button to archive your first URL."
                : "Nothing has been archived here yet."}
            </EmptyState>
          ) : (
            <EmptyState icon={<SlidersHorizontal size={24} />} title="No results match your filter">
              Try a different search term. The filter only looks at the {snapshots.length} snapshots
              on this page.
            </EmptyState>
          )
        ) : density === "grid" ? (
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4 p-4 sm:p-5">
            {filtered.map((snapshot) => (
              <SnapshotCard
                key={snapshot.id}
                snapshot={snapshot}
                selected={canWrite && bulk.selectedIds.has(snapshot.id)}
                onToggle={canWrite ? bulk.toggle : undefined}
                to={rowTo(snapshot.id)}
                state={rowState}
              />
            ))}
          </ul>
        ) : (
          <ul className="m-0 list-none p-0">
            {filtered.map((snapshot) => (
              <SnapshotRow
                key={snapshot.id}
                snapshot={snapshot}
                selected={canWrite && bulk.selectedIds.has(snapshot.id)}
                onToggle={canWrite ? bulk.toggle : undefined}
                density={density}
                to={rowTo(snapshot.id)}
                state={rowState}
              />
            ))}
          </ul>
        )}

        {!loading && !isError && (
          <Pagination
            page={Math.min(page, totalPages)}
            totalPages={totalPages}
            onPrev={() => goToPage(Math.max(1, page - 1))}
            onNext={() => goToPage(Math.min(totalPages, page + 1))}
            onPage={goToPage}
          />
        )}
        {/* Room for the floating bulk bar so it never covers the last row. */}
        {canWrite && bulk.someSelected && <div className="h-16" />}
      </div>

      {canWrite && bulk.someSelected && (
        <BulkBar
          count={bulk.selectedIds.size}
          status={bulk.status}
          allTags={allTags}
          onDelete={bulk.bulkDelete}
          onTag={bulk.bulkTag}
          onClear={bulk.clearSelection}
        />
      )}
    </div>
  );
}
