import { WebFrostClient, WebFrostError } from "@webfrost/sdk";
import type { Snapshot, SnapshotDetail } from "@webfrost/sdk";
import { useCallback, useEffect, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";

// "/api" — routes are mounted at /api/snapshots on the Elysia server;
// in dev the Vite proxy forwards /api → localhost:3000
const client = new WebFrostClient({ baseUrl: "/api" });

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
        <span
          style={{ color: "#0070f3", wordBreak: "break-all", flexShrink: 1, fontSize: "0.875rem" }}
        >
          {snapshot.url}
        </span>
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
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [url, setUrl] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // Filter state
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [reqExtractors, setReqExtractors] = useState<Set<string>>(new Set());

  const fetchSnapshots = useCallback(async () => {
    try {
      const data = await client.listSnapshots();
      setSnapshots(data);
    } catch (e) {
      setError(e instanceof WebFrostError ? e.message : String(e));
    } finally {
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSnapshots();
  }, [fetchSnapshots]);

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
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1.5rem", color: "#111" }}>
        WebFrost
      </h1>

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
          type="text"
          placeholder="Filter by URL…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          style={{ ...inputStyle, width: "100%" }}
        />
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
      </div>

      {/* Snapshot list */}
      {initialLoading ? (
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
      ) : filtered.length === 0 ? (
        <p style={{ color: "#9ca3af", textAlign: "center", marginTop: "3rem" }}>
          {snapshots.length === 0
            ? "No snapshots yet. Archive a URL above."
            : "No snapshots match your filters."}
        </p>
      ) : (
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
      )}
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
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<SnapshotDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  }, [id]);

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
// App — router
// ---------------------------------------------------------------------------

export default function App() {
  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <Routes>
        <Route path="/" element={<ListPage />} />
        <Route path="/snapshots/:id" element={<DetailPage />} />
      </Routes>
    </>
  );
}
