import { AlignJustify, LayoutList, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Pagination } from "../components/Pagination";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/StateViews";
import { useAuth } from "../context/auth";
import { BulkBar } from "../features/snapshots/BulkBar";
import { NewSnapshotMenu } from "../features/snapshots/NewSnapshotMenu";
import { type Density, SnapshotRow } from "../features/snapshots/SnapshotRow";
import { SnapshotDetailPanel } from "../features/snapshots/detail/SnapshotDetailPanel";
import { useBulkSnapshots } from "../hooks/useBulkSnapshots";
import { useCreateSnapshot, useSnapshots } from "../hooks/useSnapshots";
import { useTags } from "../hooks/useTags";
import { STORAGE_KEYS, readStorage, writeStorage } from "../lib/storage";
import { parsePositiveInt } from "../lib/url";

const PAGE_SIZE = 20;

export function SnapshotListPage() {
  const { canWrite } = useAuth();
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  // The detail panel opens over the list from /snapshots/:id; ?detail= is the older spelling
  // of the same thing and keeps working. A malformed id (abc, 0, -1) simply opens nothing.
  const detailId = parsePositiveInt(params.id ?? searchParams.get("detail"));
  const page = parsePositiveInt(searchParams.get("page")) ?? 1;

  const { snapshots, total, loading, isError, error, refetch } = useSnapshots(page, PAGE_SIZE);
  const { tags: allTags } = useTags();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const [search, setSearch] = useState("");
  const [density, setDensity] = useState<Density>(() =>
    readStorage(STORAGE_KEYS.snapshotDensity) === "compact" ? "compact" : "comfortable",
  );

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

  /** Query string kept while the panel opens and closes: the page number, never the panel id. */
  function listSearch(): string {
    const next = new URLSearchParams(searchParams);
    next.delete("detail");
    const s = next.toString();
    return s ? `?${s}` : "";
  }

  const rowTo = (id: number) => `/snapshots/${id}${listSearch()}`;

  function closeDetail() {
    if (params.id !== undefined) {
      navigate(`/snapshots${listSearch()}`);
      return;
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("detail");
      return next;
    });
  }

  const filtering = search.trim().length > 0;

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col overflow-hidden bg-app lg:h-dvh">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex items-center gap-3">
          <h1 className="m-0 text-ui-lg font-semibold text-high">Snapshots</h1>
          {!loading && !isError && (
            <span
              className="rounded bg-overlay px-1.5 py-0.5 text-ui-xs text-mid"
              title={filtering ? "Matches on this page" : "Total snapshots"}
            >
              {filtering ? filtered.length : total}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
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
            aria-label="Row density"
            className="flex overflow-hidden rounded-md border border-border"
          >
            {(["comfortable", "compact"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDensityAndPersist(d)}
                title={d}
                aria-label={`${d} rows`}
                aria-pressed={density === d}
                className={`flex items-center justify-center border-0 p-1.5 transition-colors ${
                  density === d
                    ? "bg-overlay text-high"
                    : "bg-transparent text-low hover:bg-subtle hover:text-high"
                }`}
              >
                {d === "comfortable" ? (
                  <AlignJustify size={14} aria-hidden="true" />
                ) : (
                  <LayoutList size={14} aria-hidden="true" />
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

      {/* ── Table header ────────────────────────────────────── */}
      <div
        aria-hidden={loading || isError || filtered.length === 0 ? true : undefined}
        className="flex h-8 shrink-0 items-center border-b border-border bg-surface text-ui-xs text-low"
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

      {/* ── List ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {loading ? (
          // Skeleton rows are <li> without a link, so they are never mistaken for data rows.
          <ul className="m-0 list-none p-0" role="status" aria-label="Loading snapshots">
            {Array.from({ length: 10 }, (_, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
                key={i}
                className={`flex items-center gap-3 border-b border-border px-5 ${
                  density === "comfortable" ? "h-14" : "h-9"
                }`}
              >
                <Skeleton className="size-3" />
                {density === "comfortable" && <Skeleton className="hidden h-10 w-14 sm:block" />}
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-2.5 w-3/5" />
                  {density === "comfortable" && <Skeleton className="h-2 w-2/5" />}
                </div>
              </li>
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

      {detailId !== null && (
        <SnapshotDetailPanel
          key={detailId}
          snapshotId={detailId}
          onClose={closeDetail}
          onDeleted={async () => {
            await refetch();
            closeDetail();
          }}
        />
      )}
    </div>
  );
}
