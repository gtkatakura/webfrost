import { WebFrostError } from "@webfrost/sdk";
import type { SnapshotDetail } from "@webfrost/sdk";
import { ArrowLeft, Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArchiveResultSection,
  ErrorBanner,
  SkeletonRow,
  SnapshotTagSection,
  StatusBadge,
} from "../components";
import { useClient } from "../context";

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
      toast.success("Snapshot deleted");
      navigate("/");
    } catch (e) {
      toast.error(e instanceof WebFrostError ? e.message : String(e));
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
        className="bg-transparent border-0 text-primary cursor-pointer text-sm p-0 mb-6 inline-flex items-center gap-1.5 hover:opacity-80 transition-opacity"
      >
        <ArrowLeft size={14} /> Back
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
          <h1 className="text-[1.1rem] font-bold mb-5 text-gray-900 dark:text-gray-100 break-all leading-snug">
            <a href={detail.url} target="_blank" rel="noreferrer">
              {detail.url}
            </a>
          </h1>

          <div className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-sm mb-7 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md py-3 px-4">
            <span className="text-gray-500 dark:text-gray-400">ID</span>
            <span className="text-gray-900 dark:text-gray-100">{detail.id}</span>
            <span className="text-gray-500 dark:text-gray-400">Status</span>
            <span>
              <StatusBadge status={detail.status} />
            </span>
            <span className="text-gray-500 dark:text-gray-400">Created</span>
            <span className="text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
              <Clock size={12} className="text-gray-400" />
              {new Date(detail.createdAt).toLocaleString()}
            </span>
          </div>

          <div className="mb-7">
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className={`bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 text-sm rounded-md py-1.5 px-3.5 ${
                deleting ? "cursor-not-allowed opacity-60" : "cursor-pointer"
              }`}
            >
              {deleting ? "Deleting…" : "Delete snapshot"}
            </button>
          </div>

          <SnapshotTagSection snapshotId={detail.id} />

          <h2 className="text-[0.95rem] font-semibold mb-3 text-gray-900 dark:text-gray-100">
            Archive Results
          </h2>

          {detail.archiveResults.length === 0 ? (
            <div className="text-center py-10 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
              <p className="text-gray-400 dark:text-gray-500 text-sm">
                No extractor results yet. Check back soon.
              </p>
            </div>
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
