import { WebFrostError } from "@webfrost/sdk";
import { Camera, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { BulkActionBar, Pagination, SkeletonRow, SnapshotListRow } from "../components";
import { useClient } from "../context";
import { useBulkSnapshots, useSearch, useSnapshots, useTags } from "../hooks";
import { FtsResults } from "./FtsResults";
import { SnapshotFilters } from "./SnapshotFilters";

const PAGE_SIZE = 20;
const inputCls =
  "py-2 px-3 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500";

export function SnapshotListPage() {
  const client = useClient();
  const {
    snapshots,
    loading: initialLoading,
    error: snapshotsError,
    setError,
    refetch,
  } = useSnapshots();
  const { tags: allTags } = useTags();

  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [page, setPage] = useState(1);

  const [ftsQuery, setFtsQuery] = useState("");
  const { results: ftsResults, loading: ftsLoading } = useSearch(ftsQuery);

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [reqExtractors, setReqExtractors] = useState<Set<string>>(new Set());
  const [reqTags, setReqTags] = useState<Set<number>>(new Set());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await client.createSnapshot(url);
      setUrl("");
      setPage(1);
      await refetch();
      toast.success("Snapshot queued successfully");
    } catch (e) {
      toast.error(e instanceof WebFrostError ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  function toggleExtractor(ext: string) {
    setReqExtractors((prev) => {
      const next = new Set(prev);
      if (next.has(ext)) next.delete(ext);
      else next.add(ext);
      return next;
    });
    setPage(1);
  }

  function toggleTag(tagId: number) {
    setReqTags((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
    setPage(1);
  }

  const filtered = snapshots.filter((s) => {
    if (search && !s.url.toLowerCase().includes(search.toLowerCase())) return false;
    if (dateFrom && new Date(s.createdAt) < new Date(dateFrom)) return false;
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      if (new Date(s.createdAt) > to) return false;
    }
    if (reqExtractors.size > 0) {
      const extSet = new Set(s.extractors);
      for (const req of reqExtractors) {
        if (!extSet.has(req)) return false;
      }
    }
    if (reqTags.size > 0) {
      const snapshotTagIds = new Set(s.tags.map((t) => t.id));
      for (const req of reqTags) {
        if (!snapshotTagIds.has(req)) return false;
      }
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const bulk = useBulkSnapshots(
    pageItems.map((s) => s.id),
    refetch,
  );

  useEffect(() => {
    if (snapshotsError) {
      toast.error(snapshotsError);
      setError(null);
    }
  }, [snapshotsError, setError]);

  return (
    <main className="max-w-[760px] mx-auto py-8 px-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 m-0">WebFrost</h1>
        <Link to="/tags" className="text-sm">
          Manage Tags
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 mb-6">
        <input
          type="url"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          className={`flex-1 ${inputCls}`}
        />
        <button
          type="submit"
          disabled={submitting}
          className={`py-2 px-5 bg-primary text-white border-0 rounded font-semibold ${
            submitting ? "cursor-not-allowed opacity-70" : "cursor-pointer"
          }`}
        >
          {submitting ? "Archiving…" : "Archive"}
        </button>
      </form>

      <SnapshotFilters
        ftsQuery={ftsQuery}
        search={search}
        dateFrom={dateFrom}
        dateTo={dateTo}
        reqExtractors={reqExtractors}
        reqTags={reqTags}
        allTags={allTags}
        onFtsQueryChange={(v) => {
          setFtsQuery(v);
          setPage(1);
        }}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        onDateFromChange={(v) => {
          setDateFrom(v);
          setPage(1);
        }}
        onDateToChange={(v) => {
          setDateTo(v);
          setPage(1);
        }}
        onToggleExtractor={toggleExtractor}
        onToggleTag={toggleTag}
      />

      {ftsQuery.trim() && <FtsResults query={ftsQuery} results={ftsResults} loading={ftsLoading} />}

      {!ftsQuery.trim() && initialLoading ? (
        <ul className="list-none p-0 flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders have no identity
            <SkeletonRow key={i} />
          ))}
        </ul>
      ) : !ftsQuery.trim() && filtered.length === 0 ? (
        <div className="text-center mt-16 px-4">
          {snapshots.length === 0 ? (
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                <Camera size={28} className="text-gray-400 dark:text-gray-500" />
              </div>
              <div>
                <p className="text-gray-700 dark:text-gray-300 font-semibold text-base">
                  No snapshots yet
                </p>
                <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">
                  Enter a URL above to archive your first page.
                </p>
              </div>
              <Link
                to="/import"
                className="inline-block px-4 py-2 text-sm font-medium rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors no-underline"
              >
                Or import from RSS / Bookmarks →
              </Link>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                <SlidersHorizontal size={28} className="text-gray-400 dark:text-gray-500" />
              </div>
              <div>
                <p className="text-gray-700 dark:text-gray-300 font-semibold text-base">
                  No snapshots match your filters
                </p>
                <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">
                  Try adjusting the search or filter criteria.
                </p>
              </div>
            </div>
          )}
        </div>
      ) : !ftsQuery.trim() ? (
        <>
          {pageItems.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={bulk.allSelected}
                onChange={bulk.toggleAll}
                className="cursor-pointer"
              />
              Select all
            </label>
          )}
          <ul className="list-none p-0 flex flex-col gap-3">
            {pageItems.map((s) => (
              <SnapshotListRow
                key={s.id}
                snapshot={s}
                selected={bulk.selectedIds.has(s.id)}
                onToggle={bulk.toggle}
              />
            ))}
          </ul>

          <Pagination
            page={safePage}
            totalPages={totalPages}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
            onPage={setPage}
          />
        </>
      ) : null}

      {bulk.someSelected && (
        <BulkActionBar
          count={bulk.selectedIds.size}
          status={bulk.status}
          allTags={allTags}
          onDelete={bulk.bulkDelete}
          onTag={bulk.bulkTag}
        />
      )}
    </main>
  );
}
