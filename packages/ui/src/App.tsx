import { WebFrostClient, WebFrostError } from "@webfrost/sdk";
import type { Snapshot, SnapshotDetail } from "@webfrost/sdk";
import { useCallback, useEffect, useState } from "react";

// "/api" — routes are mounted at /api/snapshots on the Elysia server;
// in dev the Vite proxy forwards /api → localhost:3000
const client = new WebFrostClient({ baseUrl: "/api" });

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Skeleton loading row
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

// ---------------------------------------------------------------------------
// Extractor badge
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Snapshot row (expandable)
// ---------------------------------------------------------------------------
function SnapshotRow({ snapshot }: { snapshot: Snapshot }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<SnapshotDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  async function toggleExpand() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (detail) return;
    setLoadingDetail(true);
    setDetailError(null);
    try {
      const d = await client.getSnapshot(snapshot.id);
      setDetail(d);
    } catch (e) {
      setDetailError(e instanceof WebFrostError ? e.message : String(e));
    } finally {
      setLoadingDetail(false);
    }
  }

  const ts = new Date(snapshot.createdAt).toLocaleString();

  return (
    <li
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        style={{
          width: "100%",
          padding: "0.75rem 1rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "1rem",
          cursor: "pointer",
          background: expanded ? "#f9fafb" : "white",
          border: "none",
          textAlign: "left",
        }}
        onClick={toggleExpand}
      >
        <a
          href={snapshot.url}
          target="_blank"
          rel="noreferrer"
          style={{ color: "#0070f3", wordBreak: "break-all", flexShrink: 1 }}
          onClick={(e) => e.stopPropagation()}
        >
          {snapshot.url}
        </a>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "0.2rem",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: "0.75rem",
              padding: "0.15rem 0.5rem",
              borderRadius: 12,
              background: snapshot.status === "done" ? "#d1fae5" : "#fef3c7",
              color: snapshot.status === "done" ? "#065f46" : "#92400e",
              fontWeight: 600,
            }}
          >
            {snapshot.status}
          </span>
          <span style={{ fontSize: "0.7rem", color: "#9ca3af" }}>{ts}</span>
        </div>
      </button>

      {expanded && (
        <div
          style={{
            padding: "0.6rem 1rem",
            borderTop: "1px solid #e5e7eb",
            background: "#f9fafb",
            fontSize: "0.85rem",
          }}
        >
          {loadingDetail && <span style={{ color: "#6b7280" }}>Loading extractors…</span>}
          {detailError && <span style={{ color: "red" }}>Error: {detailError}</span>}
          {detail &&
            (detail.archiveResults.length === 0 ? (
              <span style={{ color: "#6b7280" }}>No extractor results yet.</span>
            ) : (
              <div>
                <span style={{ color: "#6b7280", marginRight: "0.5rem" }}>Extractors:</span>
                {detail.archiveResults.map((r) => (
                  <ExtractorBadge
                    key={r.id}
                    extractor={r.extractor}
                    hasContent={r.content !== null}
                  />
                ))}
              </div>
            ))}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------
export default function App() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [url, setUrl] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

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

  const totalPages = Math.max(1, Math.ceil(snapshots.length / PAGE_SIZE));
  const pageItems = snapshots.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        * { box-sizing: border-box; }
        body { margin: 0; background: #f8fafc; }
      `}</style>
      <main
        style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          maxWidth: 760,
          margin: "0 auto",
          padding: "2rem 1rem",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1.5rem", color: "#111" }}>
          WebFrost
        </h1>

        {/* Submit form */}
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", gap: "0.5rem", marginBottom: "2rem" }}
        >
          <input
            type="url"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            style={{
              flex: 1,
              padding: "0.5rem 0.75rem",
              border: "1px solid #d1d5db",
              borderRadius: 4,
              fontSize: "0.95rem",
            }}
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
        {error && (
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
            {error}
          </p>
        )}

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
        ) : snapshots.length === 0 ? (
          <p style={{ color: "#9ca3af", textAlign: "center", marginTop: "3rem" }}>
            No snapshots yet. Archive a URL above.
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
                <SnapshotRow key={s.id} snapshot={s} />
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
                  disabled={page === 1}
                  style={{
                    padding: "0.35rem 0.75rem",
                    border: "1px solid #d1d5db",
                    borderRadius: 4,
                    background: "white",
                    cursor: page === 1 ? "not-allowed" : "pointer",
                    opacity: page === 1 ? 0.4 : 1,
                  }}
                >
                  ‹ Prev
                </button>
                <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  style={{
                    padding: "0.35rem 0.75rem",
                    border: "1px solid #d1d5db",
                    borderRadius: 4,
                    background: "white",
                    cursor: page === totalPages ? "not-allowed" : "pointer",
                    opacity: page === totalPages ? 0.4 : 1,
                  }}
                >
                  Next ›
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
