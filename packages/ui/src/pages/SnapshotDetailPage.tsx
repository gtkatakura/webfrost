import { WebFrostError } from "@webfrost/sdk";
import type { SnapshotDetail } from "@webfrost/sdk";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ErrorBanner,
  ExtractorBadge,
  SkeletonRow,
  SnapshotTagSection,
  StatusBadge,
} from "../components";
import { useClient } from "../context";

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

export function SnapshotDetailPage() {
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

          <SnapshotTagSection snapshotId={detail.id} />

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
