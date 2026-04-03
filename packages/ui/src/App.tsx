import { WebFrostClient, WebFrostError } from "@webfrost/sdk";
import type { SearchResult, Snapshot, SnapshotDetail, Tag } from "@webfrost/sdk";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";

// "/api" — routes are mounted at /api/snapshots on the Elysia server;
// in dev the Vite proxy forwards /api → localhost:3000
const defaultClient = new WebFrostClient({ baseUrl: "/api" });

const ClientContext = createContext<WebFrostClient>(defaultClient);

function useClient(): WebFrostClient {
  return useContext(ClientContext);
}

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Shared small components
// ---------------------------------------------------------------------------

function SkeletonRow() {
  return (
    <li className="py-3 px-4 border border-gray-200 rounded-md flex justify-between items-center gap-4">
      <span className="inline-block w-3/5 h-4 bg-gray-200 rounded animate-pulse" />
      <span className="inline-block w-[10%] h-4 bg-gray-200 rounded animate-pulse" />
    </li>
  );
}

function ExtractorBadge({ extractor, hasContent }: { extractor: string; hasContent: boolean }) {
  return (
    <span
      title={extractor}
      className={`inline-block py-0.5 px-1.5 rounded-sm text-[0.7rem] font-semibold mr-1 ${
        hasContent ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
      }`}
    >
      {extractor}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`text-xs py-0.5 px-2 rounded-full font-semibold ${
        status === "done" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
      }`}
    >
      {status}
    </span>
  );
}

function TagChip({
  tag,
  onRemove,
}: {
  tag: Tag;
  onRemove?: () => void;
}) {
  const bg = tag.color ?? "#e5e7eb";
  // Compute a contrasting text color based on luminance
  const hex = bg.replace("#", "");
  let textColor = "#111";
  if (hex.length === 6) {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    textColor = lum > 0.55 ? "#111" : "#fff";
  }
  return (
    <span
      className="inline-flex items-center gap-0.5 py-0.5 px-[0.45rem] rounded-full text-[0.7rem] font-semibold mr-0.5"
      style={{ background: bg, color: textColor }}
    >
      {tag.name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          className="bg-transparent border-0 cursor-pointer p-0 leading-none text-[0.75rem]"
          style={{ color: textColor }}
          aria-label={`Remove tag ${tag.name}`}
        >
          ×
        </button>
      )}
    </span>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return <p className="text-red-700 bg-red-100 py-2.5 px-3.5 rounded mb-4 text-sm">{message}</p>;
}

// ---------------------------------------------------------------------------
// List page
// ---------------------------------------------------------------------------

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

const KNOWN_EXTRACTORS = ["warc", "readability", "pdf"] as const;

const inputCls = "py-2 px-3 border border-gray-300 rounded text-sm";

function ListPage() {
  const client = useClient();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [url, setUrl] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // FTS search state
  const [ftsQuery, setFtsQuery] = useState("");
  const [ftsResults, setFtsResults] = useState<SearchResult[]>([]);
  const [ftsLoading, setFtsLoading] = useState(false);

  // Filter state (used when ftsQuery is empty)
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [reqExtractors, setReqExtractors] = useState<Set<string>>(new Set());
  const [reqTags, setReqTags] = useState<Set<number>>(new Set());

  const fetchSnapshots = useCallback(async () => {
    try {
      const [data, tags] = await Promise.all([client.listSnapshots(), client.listTags()]);
      setSnapshots(data);
      setAllTags(tags);
    } catch (e) {
      setError(e instanceof WebFrostError ? e.message : String(e));
    } finally {
      setInitialLoading(false);
    }
  }, [client]);

  useEffect(() => {
    fetchSnapshots();
  }, [fetchSnapshots]);

  // Debounced FTS search: fires 400 ms after the user stops typing
  useEffect(() => {
    if (!ftsQuery.trim()) {
      setFtsResults([]);
      return;
    }
    setFtsLoading(true);
    const timer = setTimeout(() => {
      client
        .searchSnapshots(ftsQuery)
        .then((results) => {
          setFtsResults(results);
        })
        .catch(() => {
          setFtsResults([]);
        })
        .finally(() => setFtsLoading(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [ftsQuery, client]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await client.createSnapshot(url);
      setUrl("");
      setPage(1);
      await fetchSnapshots();
    } catch (e) {
      setError(e instanceof WebFrostError ? e.message : String(e));
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

  // Apply filters
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

      {/* Archive URL form */}
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

      {/* Error banner */}
      {error && <ErrorBanner message={error} />}

      {/* Search and filter controls */}
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

      {/* FTS search results */}
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

      {/* Snapshot list (hidden when FTS is active) */}
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

          {/* Pagination */}
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

// ---------------------------------------------------------------------------
// Detail page
// ---------------------------------------------------------------------------

interface ReadabilityContent {
  title?: string | null;
  byline?: string | null;
  textContent?: string | null;
  excerpt?: string | null;
}

function ArchiveResultSection({
  result,
  snapshotId,
}: {
  result: SnapshotDetail["archiveResults"][number];
  snapshotId: number;
}) {
  const downloadUrl = `/api/snapshots/${snapshotId}/archives/${result.extractor}/download`;

  if (result.extractor === "readability" && result.content) {
    let parsed: ReadabilityContent = {};
    try {
      parsed = JSON.parse(result.content) as ReadabilityContent;
    } catch {
      // leave as empty
    }
    return (
      <div className="border border-gray-200 rounded-md p-4 mb-3">
        <div className="mb-2">
          <ExtractorBadge extractor="readability" hasContent={true} />
        </div>
        {parsed.title && <p className="m-0 mb-1 font-semibold text-[0.95rem]">{parsed.title}</p>}
        {parsed.byline && <p className="m-0 mb-1 text-gray-500 text-[0.85rem]">{parsed.byline}</p>}
        {parsed.excerpt && (
          <p className="m-0 mb-3 text-gray-700 text-sm">
            <em>{parsed.excerpt}</em>
          </p>
        )}
        {parsed.textContent && (
          <pre className="bg-gray-100 p-3 rounded text-[0.8rem] overflow-x-auto whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto m-0 mb-2">
            {parsed.textContent.slice(0, 500)}
            {parsed.textContent.length > 500 ? "…" : ""}
          </pre>
        )}
        <a href={downloadUrl} className="text-[0.8rem]">
          Download JSON
        </a>
      </div>
    );
  }

  // WARC, PDF, or unknown
  const labels: Record<string, string> = { warc: "WARC archive", pdf: "PDF" };
  const label = labels[result.extractor] ?? result.extractor;

  return (
    <div className="border border-gray-200 rounded-md py-3 px-4 mb-3 flex items-center gap-3">
      <ExtractorBadge extractor={result.extractor} hasContent={result.content !== null} />
      {result.content ? (
        <a href={downloadUrl} className="text-sm">
          Download {label}
        </a>
      ) : (
        <span className="text-sm text-gray-400">No output</span>
      )}
    </div>
  );
}

function DetailPage() {
  const client = useClient();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<SnapshotDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!id) return;
    if (!window.confirm("Delete this snapshot and all its artifacts? This cannot be undone.")) {
      return;
    }
    setDeleting(true);
    try {
      await client.deleteSnapshot(Number(id));
      navigate("/");
    } catch (e) {
      setError(e instanceof WebFrostError ? e.message : String(e));
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (!id) return;
    client
      .getSnapshot(Number(id))
      .then((d) => {
        if (!d) setError("Snapshot not found.");
        else setDetail(d);
      })
      .catch((e: unknown) => {
        setError(e instanceof WebFrostError ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, [id, client]);

  return (
    <main className="max-w-[760px] mx-auto py-8 px-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="bg-transparent border-0 text-primary cursor-pointer text-sm p-0 mb-6 inline-flex items-center gap-1"
      >
        ← Back
      </button>

      {loading && (
        <ul className="list-none p-0 flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders have no identity
            <SkeletonRow key={i} />
          ))}
        </ul>
      )}

      {error && <ErrorBanner message={error} />}

      {detail && (
        <>
          <h1 className="text-[1.1rem] font-bold mb-5 text-gray-900 break-all leading-snug">
            <a href={detail.url} target="_blank" rel="noreferrer">
              {detail.url}
            </a>
          </h1>

          {/* Metadata grid */}
          <div className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-sm mb-7 bg-white border border-gray-200 rounded-md py-3 px-4">
            <span className="text-gray-500">ID</span>
            <span>{detail.id}</span>
            <span className="text-gray-500">Status</span>
            <span>
              <StatusBadge status={detail.status} />
            </span>
            <span className="text-gray-500">Created</span>
            <span>{new Date(detail.createdAt).toLocaleString()}</span>
          </div>

          <div className="mb-7">
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className={`bg-red-100 border border-red-300 text-red-700 text-sm rounded-md py-1.5 px-3.5 ${
                deleting ? "cursor-not-allowed opacity-60" : "cursor-pointer"
              }`}
            >
              {deleting ? "Deleting…" : "Delete snapshot"}
            </button>
          </div>

          <h2 className="text-[0.95rem] font-semibold mb-3 text-gray-900">Archive Results</h2>

          {detail.archiveResults.length === 0 ? (
            <p className="text-gray-400">No extractor results yet.</p>
          ) : (
            detail.archiveResults.map((r) => (
              <ArchiveResultSection key={r.id} result={r} snapshotId={detail.id} />
            ))
          )}
        </>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Tags management page
// ---------------------------------------------------------------------------

function TagsPage() {
  const client = useClient();
  const navigate = useNavigate();
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6b7280");
  const [creating, setCreating] = useState(false);

  const fetchTags = useCallback(async () => {
    try {
      const data = await client.listTags();
      setTags(data);
    } catch (e) {
      setError(e instanceof WebFrostError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await client.createTag(newName.trim(), newColor);
      setNewName("");
      await fetchTags();
    } catch (e) {
      setError(e instanceof WebFrostError ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(tagId: number) {
    setError(null);
    try {
      await client.deleteTag(tagId);
      setTags((prev) => prev.filter((t) => t.id !== tagId));
    } catch (e) {
      setError(e instanceof WebFrostError ? e.message : String(e));
    }
  }

  return (
    <main className="max-w-[760px] mx-auto py-8 px-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="bg-transparent border-0 text-primary cursor-pointer text-sm p-0 mb-6 inline-flex items-center gap-1"
      >
        ← Back
      </button>

      <h1 className="text-2xl font-bold mb-6 text-gray-900">Tags</h1>

      <form onSubmit={handleCreate} className="flex gap-2 mb-6 items-center">
        <input
          type="text"
          placeholder="New tag name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          required
          className={`flex-1 ${inputCls}`}
        />
        <label className="flex items-center gap-1.5 text-sm">
          Color
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="w-9 h-8 p-0.5 border border-gray-300 rounded cursor-pointer"
          />
        </label>
        <button
          type="submit"
          disabled={creating}
          className={`py-2 px-5 bg-primary text-white border-0 rounded font-semibold ${
            creating ? "cursor-not-allowed opacity-70" : "cursor-pointer"
          }`}
        >
          {creating ? "Creating…" : "Create"}
        </button>
      </form>

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <p className="text-gray-400">Loading…</p>
      ) : tags.length === 0 ? (
        <p className="text-gray-400">No tags yet. Create one above.</p>
      ) : (
        <ul className="list-none p-0 flex flex-col gap-2">
          {tags.map((tag) => (
            <li
              key={tag.id}
              className="flex justify-between items-center py-2.5 px-4 border border-gray-200 rounded-md bg-white"
            >
              <TagChip tag={tag} />
              <button
                type="button"
                onClick={() => handleDelete(tag.id)}
                className="bg-transparent border border-red-300 text-red-700 rounded cursor-pointer py-1 px-2.5 text-xs"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// App — router
// ---------------------------------------------------------------------------

export default function App({ client = defaultClient }: { client?: WebFrostClient }) {
  return (
    <ClientContext.Provider value={client}>
      <Routes>
        <Route path="/" element={<ListPage />} />
        <Route path="/snapshots/:id" element={<DetailPage />} />
        <Route path="/tags" element={<TagsPage />} />
      </Routes>
    </ClientContext.Provider>
  );
}
