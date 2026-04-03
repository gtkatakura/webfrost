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

const GLOBAL_CSS = `
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f8fafc; font-family: system-ui, -apple-system, sans-serif; }
  a { color: #0070f3; text-decoration: none; }
  a:hover { text-decoration: underline; }
`;

// ---------------------------------------------------------------------------
// Shared small components
// ---------------------------------------------------------------------------

function SkeletonRow() {
  return (
    <li
      style={{
        padding: "0.75rem 1rem",
        border: "1px solid #e5e7eb",
        borderRadius: 6,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "1rem",
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: "60%",
          height: "1rem",
          background: "#e5e7eb",
          borderRadius: 4,
          animation: "pulse 1.4s ease-in-out infinite",
        }}
      />
      <span
        style={{
          display: "inline-block",
          width: "10%",
          height: "1rem",
          background: "#e5e7eb",
          borderRadius: 4,
          animation: "pulse 1.4s ease-in-out infinite",
        }}
      />
    </li>
  );
}

function ExtractorBadge({ extractor, hasContent }: { extractor: string; hasContent: boolean }) {
  return (
    <span
      title={extractor}
      style={{
        display: "inline-block",
        padding: "0.15rem 0.4rem",
        borderRadius: 3,
        fontSize: "0.7rem",
        fontWeight: 600,
        background: hasContent ? "#d1fae5" : "#fee2e2",
        color: hasContent ? "#065f46" : "#991b1b",
        marginRight: "0.25rem",
      }}
    >
      {extractor}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      style={{
        fontSize: "0.75rem",
        padding: "0.15rem 0.5rem",
        borderRadius: 12,
        background: status === "done" ? "#d1fae5" : "#fef3c7",
        color: status === "done" ? "#065f46" : "#92400e",
        fontWeight: 600,
      }}
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
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.2rem",
        padding: "0.1rem 0.45rem",
        borderRadius: 12,
        fontSize: "0.7rem",
        fontWeight: 600,
        background: bg,
        color: textColor,
        marginRight: "0.2rem",
      }}
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
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: textColor,
            padding: 0,
            lineHeight: 1,
            fontSize: "0.75rem",
          }}
          aria-label={`Remove tag ${tag.name}`}
        >
          ×
        </button>
      )}
    </span>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <p
      style={{
        color: "#b91c1c",
        background: "#fee2e2",
        padding: "0.6rem 0.9rem",
        borderRadius: 4,
        marginBottom: "1rem",
        fontSize: "0.875rem",
      }}
    >
      {message}
    </p>
  );
}

// ---------------------------------------------------------------------------
// List page
// ---------------------------------------------------------------------------

function SnapshotListRow({ snapshot }: { snapshot: Snapshot }) {
  const ts = new Date(snapshot.createdAt).toLocaleString();
  return (
    <li style={{ border: "1px solid #e5e7eb", borderRadius: 6, overflow: "hidden" }}>
      <Link
        to={`/snapshots/${snapshot.id}`}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          padding: "0.75rem 1rem",
          background: "white",
          gap: "1rem",
          color: "inherit",
          textDecoration: "none",
        }}
      >
        <div style={{ flexShrink: 1, minWidth: 0 }}>
          <span
            style={{
              color: "#0070f3",
              wordBreak: "break-all",
              fontSize: "0.875rem",
              display: "block",
            }}
          >
            {snapshot.url}
          </span>
          {snapshot.tags.length > 0 && (
            <div style={{ marginTop: "0.3rem" }}>
              {snapshot.tags.map((tag) => (
                <TagChip key={tag.id} tag={tag} />
              ))}
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "0.25rem",
            flexShrink: 0,
          }}
        >
          <StatusBadge status={snapshot.status} />
          <span style={{ fontSize: "0.7rem", color: "#9ca3af" }}>{ts}</span>
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

  const inputStyle = {
    padding: "0.5rem 0.75rem",
    border: "1px solid #d1d5db",
    borderRadius: 4,
    fontSize: "0.875rem",
  };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "2rem 1rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.5rem",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#111", margin: 0 }}>WebFrost</h1>
        <Link to="/tags" style={{ fontSize: "0.875rem" }}>
          Manage Tags
        </Link>
      </div>

      {/* Archive URL form */}
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}
      >
        <input
          type="url"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          style={{ flex: 1, ...inputStyle }}
        />
        <button
          type="submit"
          disabled={submitting}
          style={{
            padding: "0.5rem 1.2rem",
            background: "#0070f3",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: submitting ? "not-allowed" : "pointer",
            fontWeight: 600,
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? "Archiving…" : "Archive"}
        </button>
      </form>

      {/* Error banner */}
      {error && <ErrorBanner message={error} />}

      {/* Search and filter controls */}
      <div
        style={{
          marginBottom: "1rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
        }}
      >
        <input
          type="search"
          placeholder="Full-text search (title, content, tags)…"
          value={ftsQuery}
          onChange={(e) => {
            setFtsQuery(e.target.value);
            setPage(1);
          }}
          style={{ ...inputStyle, width: "100%" }}
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
            style={{ ...inputStyle, width: "100%" }}
          />
        )}
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            flexWrap: "wrap",
            alignItems: "center",
            fontSize: "0.8rem",
            color: "#6b7280",
          }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
            From:
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
            To:
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              style={inputStyle}
            />
          </label>
          <span style={{ marginLeft: "0.25rem" }}>Has:</span>
          {KNOWN_EXTRACTORS.map((ext) => (
            <label
              key={ext}
              style={{ display: "flex", alignItems: "center", gap: "0.2rem", cursor: "pointer" }}
            >
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
          <div
            style={{
              display: "flex",
              gap: "0.4rem",
              flexWrap: "wrap",
              alignItems: "center",
              fontSize: "0.8rem",
              color: "#6b7280",
            }}
          >
            <span>Tag:</span>
            {allTags.map((tag) => (
              <label
                key={tag.id}
                style={{ display: "flex", alignItems: "center", gap: "0.2rem", cursor: "pointer" }}
              >
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
        <div style={{ marginBottom: "1rem" }}>
          {ftsLoading ? (
            <p style={{ color: "#9ca3af" }}>Searching…</p>
          ) : ftsResults.length === 0 ? (
            <p style={{ color: "#9ca3af" }}>No results for "{ftsQuery}".</p>
          ) : (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
              }}
            >
              {ftsResults.map((r) => (
                <li
                  key={r.id}
                  style={{
                    background: "white",
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    padding: "0.75rem 1rem",
                  }}
                >
                  <Link to={`/snapshots/${r.id}`} style={{ fontWeight: 600 }}>
                    {r.url}
                  </Link>
                  {r.snippet && (
                    <p
                      style={{ margin: "0.4rem 0 0", fontSize: "0.8rem", color: "#6b7280" }}
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
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
          }}
        >
          {Array.from({ length: 5 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders have no identity
            <SkeletonRow key={i} />
          ))}
        </ul>
      ) : !ftsQuery.trim() && filtered.length === 0 ? (
        <p style={{ color: "#9ca3af", textAlign: "center", marginTop: "3rem" }}>
          {snapshots.length === 0
            ? "No snapshots yet. Archive a URL above."
            : "No snapshots match your filters."}
        </p>
      ) : !ftsQuery.trim() ? (
        <>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
            }}
          >
            {pageItems.map((s) => (
              <SnapshotListRow key={s.id} snapshot={s} />
            ))}
          </ul>

          {/* Pagination */}
          {totalPages > 1 && (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: "0.5rem",
                marginTop: "1.5rem",
                alignItems: "center",
              }}
            >
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                style={{
                  padding: "0.35rem 0.75rem",
                  border: "1px solid #d1d5db",
                  borderRadius: 4,
                  background: "white",
                  cursor: safePage === 1 ? "not-allowed" : "pointer",
                  opacity: safePage === 1 ? 0.4 : 1,
                }}
              >
                ‹ Prev
              </button>
              <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>
                {safePage} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                style={{
                  padding: "0.35rem 0.75rem",
                  border: "1px solid #d1d5db",
                  borderRadius: 4,
                  background: "white",
                  cursor: safePage === totalPages ? "not-allowed" : "pointer",
                  opacity: safePage === totalPages ? 0.4 : 1,
                }}
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
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 6,
          padding: "1rem",
          marginBottom: "0.75rem",
        }}
      >
        <div style={{ marginBottom: "0.5rem" }}>
          <ExtractorBadge extractor="readability" hasContent={true} />
        </div>
        {parsed.title && (
          <p style={{ margin: "0 0 0.25rem", fontWeight: 600, fontSize: "0.95rem" }}>
            {parsed.title}
          </p>
        )}
        {parsed.byline && (
          <p style={{ margin: "0 0 0.25rem", color: "#6b7280", fontSize: "0.85rem" }}>
            {parsed.byline}
          </p>
        )}
        {parsed.excerpt && (
          <p style={{ margin: "0 0 0.75rem", color: "#374151", fontSize: "0.875rem" }}>
            <em>{parsed.excerpt}</em>
          </p>
        )}
        {parsed.textContent && (
          <pre
            style={{
              background: "#f3f4f6",
              padding: "0.75rem",
              borderRadius: 4,
              fontSize: "0.8rem",
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 200,
              overflowY: "auto",
              margin: "0 0 0.5rem",
            }}
          >
            {parsed.textContent.slice(0, 500)}
            {parsed.textContent.length > 500 ? "…" : ""}
          </pre>
        )}
        <a href={downloadUrl} style={{ fontSize: "0.8rem" }}>
          Download JSON
        </a>
      </div>
    );
  }

  // WARC, PDF, or unknown
  const labels: Record<string, string> = { warc: "WARC archive", pdf: "PDF" };
  const label = labels[result.extractor] ?? result.extractor;

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 6,
        padding: "0.75rem 1rem",
        marginBottom: "0.75rem",
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
      }}
    >
      <ExtractorBadge extractor={result.extractor} hasContent={result.content !== null} />
      {result.content ? (
        <a href={downloadUrl} style={{ fontSize: "0.875rem" }}>
          Download {label}
        </a>
      ) : (
        <span style={{ fontSize: "0.875rem", color: "#9ca3af" }}>No output</span>
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
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "2rem 1rem" }}>
      <button
        type="button"
        onClick={() => navigate(-1)}
        style={{
          background: "none",
          border: "none",
          color: "#0070f3",
          cursor: "pointer",
          fontSize: "0.875rem",
          padding: 0,
          marginBottom: "1.5rem",
          display: "inline-flex",
          alignItems: "center",
          gap: "0.25rem",
        }}
      >
        ← Back
      </button>

      {loading && (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
          }}
        >
          {Array.from({ length: 3 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders have no identity
            <SkeletonRow key={i} />
          ))}
        </ul>
      )}

      {error && <ErrorBanner message={error} />}

      {detail && (
        <>
          <h1
            style={{
              fontSize: "1.1rem",
              fontWeight: 700,
              marginBottom: "1.25rem",
              color: "#111",
              wordBreak: "break-all",
              lineHeight: 1.4,
            }}
          >
            <a href={detail.url} target="_blank" rel="noreferrer">
              {detail.url}
            </a>
          </h1>

          {/* Metadata grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "0.4rem 1.25rem",
              fontSize: "0.875rem",
              marginBottom: "1.75rem",
              background: "white",
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              padding: "0.75rem 1rem",
            }}
          >
            <span style={{ color: "#6b7280" }}>ID</span>
            <span>{detail.id}</span>
            <span style={{ color: "#6b7280" }}>Status</span>
            <span>
              <StatusBadge status={detail.status} />
            </span>
            <span style={{ color: "#6b7280" }}>Created</span>
            <span>{new Date(detail.createdAt).toLocaleString()}</span>
          </div>

          <div style={{ marginBottom: "1.75rem" }}>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              style={{
                background: "#fee2e2",
                border: "1px solid #fca5a5",
                color: "#b91c1c",
                cursor: deleting ? "not-allowed" : "pointer",
                fontSize: "0.875rem",
                borderRadius: 6,
                padding: "0.4rem 0.875rem",
                opacity: deleting ? 0.6 : 1,
              }}
            >
              {deleting ? "Deleting…" : "Delete snapshot"}
            </button>
          </div>

          <h2
            style={{
              fontSize: "0.95rem",
              fontWeight: 600,
              marginBottom: "0.75rem",
              color: "#111",
            }}
          >
            Archive Results
          </h2>

          {detail.archiveResults.length === 0 ? (
            <p style={{ color: "#9ca3af" }}>No extractor results yet.</p>
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

  const inputStyle = {
    padding: "0.5rem 0.75rem",
    border: "1px solid #d1d5db",
    borderRadius: 4,
    fontSize: "0.875rem",
  };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "2rem 1rem" }}>
      <button
        type="button"
        onClick={() => navigate(-1)}
        style={{
          background: "none",
          border: "none",
          color: "#0070f3",
          cursor: "pointer",
          fontSize: "0.875rem",
          padding: 0,
          marginBottom: "1.5rem",
          display: "inline-flex",
          alignItems: "center",
          gap: "0.25rem",
        }}
      >
        ← Back
      </button>

      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1.5rem", color: "#111" }}>
        Tags
      </h1>

      <form
        onSubmit={handleCreate}
        style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", alignItems: "center" }}
      >
        <input
          type="text"
          placeholder="New tag name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          required
          style={{ flex: 1, ...inputStyle }}
        />
        <label
          style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.875rem" }}
        >
          Color
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            style={{
              width: 36,
              height: 32,
              padding: 2,
              border: "1px solid #d1d5db",
              borderRadius: 4,
              cursor: "pointer",
            }}
          />
        </label>
        <button
          type="submit"
          disabled={creating}
          style={{
            padding: "0.5rem 1.2rem",
            background: "#0070f3",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: creating ? "not-allowed" : "pointer",
            fontWeight: 600,
            opacity: creating ? 0.7 : 1,
          }}
        >
          {creating ? "Creating…" : "Create"}
        </button>
      </form>

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <p style={{ color: "#9ca3af" }}>Loading…</p>
      ) : tags.length === 0 ? (
        <p style={{ color: "#9ca3af" }}>No tags yet. Create one above.</p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}
        >
          {tags.map((tag) => (
            <li
              key={tag.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "0.6rem 1rem",
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                background: "white",
              }}
            >
              <TagChip tag={tag} />
              <button
                type="button"
                onClick={() => handleDelete(tag.id)}
                style={{
                  background: "none",
                  border: "1px solid #fca5a5",
                  color: "#b91c1c",
                  borderRadius: 4,
                  cursor: "pointer",
                  padding: "0.25rem 0.6rem",
                  fontSize: "0.75rem",
                }}
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
      <style>{GLOBAL_CSS}</style>
      <Routes>
        <Route path="/" element={<ListPage />} />
        <Route path="/snapshots/:id" element={<DetailPage />} />
        <Route path="/tags" element={<TagsPage />} />
      </Routes>
    </ClientContext.Provider>
  );
}
