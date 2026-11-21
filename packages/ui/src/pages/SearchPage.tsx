import { useQuery } from "@tanstack/react-query";
import type { SearchResult, Tag } from "@webfrost/sdk";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
  NO_FILTERS,
  hasFilters,
} from "../features/search/FilterSidebar";
import { SavedSearches } from "../features/search/SavedSearches";
import { useSearchPage } from "../hooks/useSearch";
import { tagKeys } from "../hooks/useTags";
import { parsePositiveInt } from "../lib/url";

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 350;

function dateFromDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function ResultCard({ result }: { result: SearchResult }) {
  return (
    <Link
      to={`/snapshots/${result.id}`}
      className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface px-4 py-3 text-inherit no-underline transition-colors hover:border-accent hover:no-underline hover:shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent)_15%,transparent)]"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-ui-base font-medium text-accent">{result.url}</span>
        <StatusBadge status={result.status} />
      </div>
      {result.snippet && (
        <div className="text-ui-sm leading-relaxed text-mid">
          <Snippet text={result.snippet} />
        </div>
      )}
    </Link>
  );
}

export function SearchPage() {
  const client = useClient();
  const [params, setParams] = useSearchParams();

  const ftsQuery = params.get("q") ?? "";
  const page = parsePositiveInt(params.get("page")) ?? 1;

  // The input is the user's draft; the URL (q) is the committed query. They are reconciled in
  // one direction at a time: typing commits to the URL after a pause, and the URL only pushes
  // into the input when q changed from somewhere else (saved search, back button, palette).
  const [inputVal, setInputVal] = useState(ftsQuery);
  const committed = useRef(ftsQuery);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (ftsQuery !== committed.current) {
      committed.current = ftsQuery;
      setInputVal(ftsQuery);
    }
  }, [ftsQuery]);

  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

  function commitQuery(q: string) {
    const trimmed = q.trim();
    committed.current = trimmed;
    // Functional update: other params (page) are read at commit time, not captured from render.
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (trimmed) next.set("q", trimmed);
        else next.delete("q");
        if (trimmed !== (prev.get("q") ?? "")) next.delete("page");
        return next;
      },
      { replace: true },
    );
  }

  function setQ(q: string, immediate = false) {
    setInputVal(q);
    if (debounce.current) clearTimeout(debounce.current);
    if (immediate) commitQuery(q);
    else debounce.current = setTimeout(() => commitQuery(q), DEBOUNCE_MS);
  }

  const {
    results: rawResults,
    total,
    loading,
    error: searchError,
    refetch,
  } = useSearchPage(ftsQuery, page, PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function goToPage(p: number) {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (p <= 1) next.delete("page");
      else next.set("page", String(p));
      return next;
    });
  }

  // ── Filters (applied to the page of results already loaded) ────────────────
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtering = hasFilters(filters);

  const { data: allTags = [] } = useQuery<Tag[]>({
    queryKey: tagKeys.list(),
    queryFn: () => client.listTags(),
  });

  const results = useMemo(() => {
    if (!hasFilters(filters)) return rawResults;
    const threshold = filters.days ? dateFromDays(filters.days) : null;
    return rawResults.filter((r) => {
      if (filters.statuses.size > 0 && (!r.status || !filters.statuses.has(r.status))) return false;
      if (threshold && r.createdAt < threshold) return false;
      for (const ext of filters.extractors) if (!r.extractors.includes(ext)) return false;
      const tagIds = new Set(r.tags.map((t) => t.id));
      for (const tid of filters.tags) if (!tagIds.has(tid)) return false;
      return true;
    });
  }, [rawResults, filters]);

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
          className="flex w-full items-center justify-between border-0 bg-transparent px-4 py-3 text-ui-base font-medium text-high lg:hidden"
        >
          <span className="inline-flex items-center gap-2">
            <SlidersHorizontal size={14} aria-hidden="true" />
            Filter this page{filtering ? " (active)" : ""}
          </span>
          <span className="text-mid">{filtersOpen ? "Hide" : "Show"}</span>
        </button>
        <div
          id="search-filters"
          className={`${filtersOpen ? "block" : "hidden"} px-4 pb-4 lg:block lg:px-4 lg:py-6`}
        >
          <FilterSidebar filters={filters} onChange={setFilters} allTags={allTags} />
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-5 sm:px-7 sm:py-6">
        <h1 className="sr-only">Search</h1>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 focus-within:border-accent">
            <Search size={15} className="shrink-0 text-low" aria-hidden="true" />
            <input
              type="text"
              aria-label="Search snapshots"
              placeholder="Search…"
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
                className="flex border-0 bg-transparent p-0 text-low hover:text-high"
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
                : filtering
                  ? `${results.length} of ${rawResults.length} result${rawResults.length !== 1 ? "s" : ""} on this page match the filters (${total} total)`
                  : `${total} result${total !== 1 ? "s" : ""}`}
            </p>
          )}

          {ftsQuery && searchError ? (
            <ErrorState title="Search failed" error={searchError} onRetry={() => refetch()} />
          ) : ftsQuery ? (
            loading ? (
              <div className="flex flex-col gap-2" role="status" aria-label="Searching">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-[4.5rem] rounded-lg" />
                ))}
              </div>
            ) : results.length === 0 ? (
              <div>
                <EmptyState icon={<Search size={26} />} title={`No results for "${ftsQuery}"`}>
                  {filtering && rawResults.length > 0
                    ? "No result on this page matches the filters. Clear them to see the other results."
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
