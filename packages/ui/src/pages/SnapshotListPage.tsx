import { WebFrostError } from "@webfrost/sdk";
import type { Snapshot } from "@webfrost/sdk";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ErrorBanner, ExtractorBadge, SkeletonRow, StatusBadge, TagChip } from "../components";
import { useClient } from "../context";
import { useSearch, useSnapshots, useTags } from "../hooks";

const PAGE_SIZE = 20;
const KNOWN_EXTRACTORS = ["warc", "readability", "pdf"] as const;
const inputCls = "py-2 px-3 border border-gray-300 rounded text-sm";

function SnapshotListRow({ snapshot }: { snapshot: Snapshot }) {
  const ts = new Date(snapshot.createdAt).toLocaleString();
  return (
    <li className="border border-gray-200 rounded-md overflow-hidden">
      <Link
        to={`/snapshots/${snapshot.id}`}
        className="flex justify-between items-start py-3 px-4 bg-white gap-4 text-inherit no-underline hover:no-underline"
      >
        <div className="shrink min-w-0">
          <span className="text-primary break-all text-sm block">{snapshot.url}</span>
          {snapshot.tags.length > 0 && (
            <div className="mt-1">
              {snapshot.tags.map((tag) => (
                <TagChip key={tag.id} tag={tag} />
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <StatusBadge status={snapshot.status} />
          <span className="text-[0.7rem] text-gray-400">{ts}</span>
          {snapshot.extractors.length > 0 && (
            <div>
              {snapshot.extractors.map((ext) => (
                <ExtractorBadge key={ext} extractor={ext} hasContent={true} />
              ))}
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}

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
  const [formError, setFormError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [ftsQuery, setFtsQuery] = useState("");
  const { results: ftsResults, loading: ftsLoading } = useSearch(ftsQuery);

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [reqExtractors, setReqExtractors] = useState<Set<string>>(new Set());
  const [reqTags, setReqTags] = useState<Set<number>>(new Set());

  const error = snapshotsError ?? formError;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setError(null);
    try {
      await client.createSnapshot(url);
      setUrl("");
      setPage(1);
      await refetch();
    } catch (e) {
      setFormError(e instanceof WebFrostError ? e.message : String(e));
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

  return (
    <main className="max-w-[760px] mx-auto py-8 px-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900 m-0">WebFrost</h1>
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

      {error && <ErrorBanner message={error} />}

      <div className="mb-4 flex flex-col gap-2">
        <input
          type="search"
          placeholder="Full-text search (title, content, tags)…"
          value={ftsQuery}
          onChange={(e) => {
            setFtsQuery(e.target.value);
            setPage(1);
          }}
          className={`w-full ${inputCls}`}
        />
        {!ftsQuery && (
          <input
            type="text"
            placeholder="Filter by URL…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className={`w-full ${inputCls}`}
          />
        )}
        <div className="flex gap-2 flex-wrap items-center text-[0.8rem] text-gray-500">
          <label className="flex items-center gap-1">
            From:
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              className={inputCls}
            />
          </label>
          <label className="flex items-center gap-1">
            To:
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              className={inputCls}
            />
          </label>
          <span className="ml-1">Has:</span>
          {KNOWN_EXTRACTORS.map((ext) => (
            <label key={ext} className="flex items-center gap-0.5 cursor-pointer">
              <input
                type="checkbox"
                checked={reqExtractors.has(ext)}
                onChange={() => toggleExtractor(ext)}
              />
              {ext}
            </label>
          ))}
        </div>
        {allTags.length > 0 && (
          <div className="flex gap-1.5 flex-wrap items-center text-[0.8rem] text-gray-500">
            <span>Tag:</span>
            {allTags.map((tag) => (
              <label key={tag.id} className="flex items-center gap-0.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={reqTags.has(tag.id)}
                  onChange={() => toggleTag(tag.id)}
                />
                <TagChip tag={tag} />
              </label>
            ))}
          </div>
        )}
      </div>

      {ftsQuery.trim() && (
        <div className="mb-4">
          {ftsLoading ? (
            <p className="text-gray-400">Searching…</p>
          ) : ftsResults.length === 0 ? (
            <p className="text-gray-400">No results for "{ftsQuery}".</p>
          ) : (
            <ul className="list-none p-0 flex flex-col gap-3">
              {ftsResults.map((r) => (
                <li key={r.id} className="bg-white border border-gray-200 rounded-lg py-3 px-4">
                  <Link to={`/snapshots/${r.id}`} className="font-semibold">
                    {r.url}
                  </Link>
                  {r.snippet && (
                    <p
                      className="mt-1.5 text-[0.8rem] text-gray-500 m-0"
                      // biome-ignore lint/security/noDangerouslySetInnerHtml: controlled server snippet
                      dangerouslySetInnerHTML={{ __html: r.snippet }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!ftsQuery.trim() && initialLoading ? (
        <ul className="list-none p-0 flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders have no identity
            <SkeletonRow key={i} />
          ))}
        </ul>
      ) : !ftsQuery.trim() && filtered.length === 0 ? (
        <p className="text-gray-400 text-center mt-12">
          {snapshots.length === 0
            ? "No snapshots yet. Archive a URL above."
            : "No snapshots match your filters."}
        </p>
      ) : !ftsQuery.trim() ? (
        <>
          <ul className="list-none p-0 flex flex-col gap-3">
            {pageItems.map((s) => (
              <SnapshotListRow key={s.id} snapshot={s} />
            ))}
          </ul>

          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-6 items-center">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className={`py-1.5 px-3 border border-gray-300 rounded bg-white ${
                  safePage === 1 ? "cursor-not-allowed opacity-40" : "cursor-pointer"
                }`}
              >
                ‹ Prev
              </button>
              <span className="text-sm text-gray-500">
                {safePage} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className={`py-1.5 px-3 border border-gray-300 rounded bg-white ${
                  safePage === totalPages ? "cursor-not-allowed opacity-40" : "cursor-pointer"
                }`}
              >
                Next ›
              </button>
            </div>
          )}
        </>
      ) : null}
    </main>
  );
}
