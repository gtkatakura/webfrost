import { useQuery } from "@tanstack/react-query";
import type { SearchResult, Tag } from "@webfrost/sdk";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Pagination } from "../components/Pagination";
import { Snippet } from "../components/Snippet";
import { StatusBadge } from "../components/StatusBadge";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/StateViews";
import { useClient } from "../context";
import { MOD_KEY } from "../features/layout/Sidebar";
import {
  FilterSidebar,
  type Filters,
  filtersFromParams,
  hasFilters,
  toSnapshotFilters,
  withFilters,
} from "../features/search/FilterSidebar";
import { SavedSearches } from "../features/search/SavedSearches";
import { useDraftParam } from "../hooks/useDraftParam";
import { useSearchPage } from "../hooks/useSearch";
import { tagKeys } from "../hooks/useTags";
import { collect } from "../lib/collect";
import { parsePositiveInt } from "../lib/url";

const PAGE_SIZE = 20;

function ResultCard({ result }: { result: SearchResult }) {
  return (
    <Link
      to={`/snapshots/${result.id}`}
      className="group flex flex-col gap-1.5 rounded-lg border border-border bg-surface px-4 py-3 text-inherit no-underline transition-colors hover:border-border-strong hover:bg-subtle/40 hover:no-underline"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          {result.title && (
            <span className="truncate text-ui-base font-medium text-high group-hover:text-accent">
              {result.title}
            </span>
          )}
          <span
            className={`truncate font-mono ${
              result.title
                ? "text-ui-xs text-mid"
                : "text-ui-sm font-medium text-high group-hover:text-accent"
            }`}
          >
            {result.url}
          </span>
        </div>
        <StatusBadge status={result.status} />
      </div>
      {result.snippet && (
        <p className="m-0 line-clamp-3 max-w-[75ch] text-ui-sm leading-relaxed text-mid">
          <Snippet text={result.snippet} />
        </p>
      )}
    </Link>
  );
}

/** Results while the search runs: the count line, then cards with ResultCard's lines and badge. */
function ResultsSkeleton() {
  return (
    <div role="status" aria-label="Searching">
      <Skeleton className="mb-3.5 h-3 w-20" />
      <div className="flex flex-col gap-2">
        {[58, 72, 46, 64].map((w) => (
          <div
            key={w}
            className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface px-4 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
                <Skeleton className="h-3.5" style={{ width: `${w}%` }} />
                <Skeleton className="h-2.5" style={{ width: `${w * 0.6}%` }} />
              </div>
              <Skeleton className="h-[18px] w-11 shrink-0 rounded-full" />
            </div>
            <div className="flex max-w-[75ch] flex-col gap-2 py-1">
              <Skeleton className="h-2.5 w-full" />
              <Skeleton className="h-2.5 w-11/12" />
              <Skeleton className="h-2.5 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SearchPage() {
  const client = useClient();
  const [params, setParams] = useSearchParams();

  const page = parsePositiveInt(params.get("page")) ?? 1;

  // The input is the draft; the URL (q) is the committed query, sent to the server.
  const { value: ftsQuery, draft: inputVal, setDraft: setQ } = useDraftParam("q");

  // ── Filters: URL parameters, applied by the server to every result ─────────
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const filtering = hasFilters(filters);
  const serverFilters = useMemo(() => toSnapshotFilters(filters), [filters]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  function setFilters(next: Filters) {
    // A new filter is a new list of results: it starts again from the first page.
    setParams((prev) => {
      const updated = withFilters(prev, next);
      updated.delete("page");
      return updated;
    });
  }

  const {
    results,
    total,
    loading,
    error: searchError,
    refetch,
  } = useSearchPage(ftsQuery, page, PAGE_SIZE, serverFilters);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // A page past the end (results shrank, or an old link) steps back to the last one, as the list does.
  useEffect(() => {
    if (!ftsQuery || loading || searchError || page <= totalPages) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (totalPages <= 1) next.delete("page");
        else next.set("page", String(totalPages));
        return next;
      },
      { replace: true },
    );
  }, [ftsQuery, loading, searchError, page, totalPages, setParams]);

  function goToPage(p: number) {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (p <= 1) next.delete("page");
      else next.set("page", String(p));
      return next;
    });
  }

  const { data: allTags = [] } = useQuery<Tag[]>({
    queryKey: tagKeys.list(),
    queryFn: () => collect(client.iterateTags()),
  });

  const pager = (
    <Pagination
      page={Math.min(page, totalPages)}
      totalPages={totalPages}
      onPrev={() => goToPage(page - 1)}
      onNext={() => goToPage(page + 1)}
      onPage={goToPage}
    />
  );

  return (
    <div className="flex min-h-[calc(100dvh-3rem)] flex-col bg-app lg:min-h-dvh lg:flex-row">
      {/* ── Filters: a column on desktop, a collapsible block above the results on mobile ── */}
      <aside
        aria-label="Filters"
        className="border-b border-border bg-surface lg:sticky lg:top-0 lg:h-dvh lg:w-60 lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-b-0"
      >
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
          aria-controls="search-filters"
          className="flex h-11 w-full items-center justify-between border-0 bg-transparent px-4 text-ui-base font-medium text-high lg:hidden"
        >
          <span className="inline-flex items-center gap-2">
            <SlidersHorizontal size={14} aria-hidden="true" />
            Filters{filtering ? " (active)" : ""}
          </span>
          <span className="text-mid">{filtersOpen ? "Hide" : "Show"}</span>
        </button>
        <div
          id="search-filters"
          className={`${filtersOpen ? "block" : "hidden"} px-2 pb-4 lg:block lg:px-2 lg:py-6`}
        >
          <FilterSidebar filters={filters} onChange={setFilters} allTags={allTags} />
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-5 sm:px-7 sm:py-6">
        <h1 className="sr-only">Search</h1>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-surface px-3 focus-within:border-accent">
            <Search size={15} className="shrink-0 text-low" aria-hidden="true" />
            <input
              type="text"
              aria-label="Search snapshots"
              placeholder="Search…"
              data-page-search
              value={inputVal}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setQ(inputVal, true)}
              className="min-w-0 flex-1 border-0 bg-transparent text-ui-base text-high placeholder:text-low"
            />
            {inputVal && (
              <button
                type="button"
                onClick={() => setQ("", true)}
                aria-label="Clear search"
                className="-mr-1.5 flex size-7 items-center justify-center rounded-md border-0 bg-transparent p-0 text-low hover:bg-subtle hover:text-high"
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>
          <SavedSearches query={ftsQuery} onApply={(q) => setQ(q, true)} />
        </div>

        <div className="mt-4">
          {ftsQuery && !loading && !searchError && (
            <p role="status" className="mb-3.5 mt-0 text-ui-sm text-mid">
              {total === 0
                ? "No results"
                : `${total} result${total !== 1 ? "s" : ""}${filtering ? ` match${total === 1 ? "es" : ""} the filters` : ""}`}
            </p>
          )}

          {ftsQuery && searchError ? (
            <ErrorState title="Search failed" error={searchError} onRetry={() => refetch()} />
          ) : ftsQuery ? (
            loading ? (
              <ResultsSkeleton />
            ) : results.length === 0 ? (
              <div>
                <EmptyState icon={<Search size={26} />} title={`No results for "${ftsQuery}"`}>
                  {filtering
                    ? "Nothing in the archive matches these words and the filters. Clear a filter to widen the search."
                    : "Try different keywords."}
                </EmptyState>
                {pager}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {results.map((r) => (
                  <ResultCard key={r.id} result={r} />
                ))}
                {pager}
              </div>
            )
          ) : (
            <EmptyState icon={<Search size={28} />} title="Start typing to search your snapshots">
              Press <kbd className="kbd">{MOD_KEY} K</kbd> for quick search from anywhere
            </EmptyState>
          )}
        </div>
      </main>
    </div>
  );
}
