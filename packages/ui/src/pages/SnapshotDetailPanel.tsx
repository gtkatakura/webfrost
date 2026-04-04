import { WebFrostError } from "@webfrost/sdk";
import type { SnapshotDetail } from "@webfrost/sdk";
import { Clock, ExternalLink, Hash, Tag as TagIcon, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArchiveResultSection, SnapshotTagSection } from "../components";
import { useClient } from "../context";

interface SnapshotDetailPanelProps {
  snapshotId: number;
  onClose: () => void;
  onDelete: () => Promise<void>;
}

export function SnapshotDetailPanel({ snapshotId, onClose, onDelete }: SnapshotDetailPanelProps) {
  const client = useClient();
  const [detail, setDetail] = useState<SnapshotDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setDetail(null);
    setError(null);

    client
      .getSnapshot(snapshotId)
      .then((d) => {
        if (!d) setError("Snapshot not found.");
        else setDetail(d);
      })
      .catch((e: unknown) => {
        setError(e instanceof WebFrostError ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, [snapshotId, client]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function handleDelete() {
    if (!window.confirm("Delete this snapshot and all its artifacts? This cannot be undone."))
      return;
    setDeleting(true);
    try {
      await client.deleteSnapshot(snapshotId);
      toast.success("Snapshot deleted");
      await onDelete();
    } catch (e) {
      toast.error(e instanceof WebFrostError ? e.message : String(e));
      setDeleting(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: "rgba(0,0,0,0.4)" }}
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        role="presentation"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed top-0 right-0 bottom-0 z-50 flex flex-col overflow-hidden animate-fade-in"
        style={{
          width: 420,
          background: "var(--bg-surface)",
          borderLeft: "1px solid var(--border-default)",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.2)",
        }}
      >
        {/* Panel header */}
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0 border-b"
          style={{ borderColor: "var(--border-default)" }}
        >
          <span className="text-ui-sm font-semibold" style={{ color: "var(--text-high)" }}>
            Snapshot Detail
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded border-0 cursor-pointer transition-colors"
            style={{ background: "transparent", color: "var(--text-mid)" }}
            aria-label="Close panel"
          >
            <X size={16} />
          </button>
        </div>

        {/* Panel content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex flex-col gap-3 mt-2">
              {[80, 60, 100, 40].map((w, i) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: skeleton items
                  key={i}
                  className="rounded animate-pulse"
                  style={{
                    height: 12,
                    width: `${w}%`,
                    background: "var(--bg-overlay)",
                  }}
                />
              ))}
            </div>
          )}

          {error && (
            <div
              className="px-3 py-2 rounded border text-ui-sm"
              style={{
                background: "color-mix(in srgb, var(--status-danger) 10%, transparent)",
                borderColor: "color-mix(in srgb, var(--status-danger) 25%, transparent)",
                color: "var(--status-danger)",
              }}
            >
              {error}
            </div>
          )}

          {detail && (
            <div className="flex flex-col gap-5">
              {/* Screenshot preview */}
              {detail.screenshotUrl && (
                <div
                  className="w-full rounded-lg overflow-hidden border"
                  style={{ borderColor: "var(--border-default)" }}
                >
                  <img
                    src={detail.screenshotUrl}
                    alt="Screenshot"
                    loading="lazy"
                    style={{ width: "100%", display: "block" }}
                  />
                </div>
              )}

              {/* Title + URL */}
              <div>
                {detail.title && (
                  <h2
                    className="text-ui-base font-semibold mb-1 m-0"
                    style={{ color: "var(--text-high)" }}
                  >
                    {detail.title}
                  </h2>
                )}
                <a
                  href={detail.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-ui-xs font-mono break-all no-underline"
                  style={{ color: "var(--accent)" }}
                >
                  {detail.url}
                  <ExternalLink size={10} style={{ flexShrink: 0 }} />
                </a>
              </div>

              {/* Metadata grid */}
              <div
                className="rounded-lg border overflow-hidden"
                style={{ borderColor: "var(--border-default)" }}
              >
                {[
                  {
                    icon: <Hash size={12} />,
                    label: "ID",
                    value: String(detail.id),
                  },
                  {
                    icon: null,
                    label: "Status",
                    value: detail.status,
                    accent: true,
                  },
                  {
                    icon: <Clock size={12} />,
                    label: "Captured",
                    value: new Date(detail.createdAt).toLocaleString(),
                  },
                ].map(({ icon, label, value, accent }) => (
                  <div
                    key={label}
                    className="flex items-center gap-3 px-3 py-2 border-b last:border-b-0"
                    style={{ borderColor: "var(--border-default)" }}
                  >
                    <span
                      className="flex items-center gap-1.5 text-ui-xs shrink-0"
                      style={{ color: "var(--text-mid)", width: 72 }}
                    >
                      {icon}
                      {label}
                    </span>
                    <span
                      className="text-ui-xs font-medium"
                      style={{
                        color: accent
                          ? detail.status === "done"
                            ? "var(--status-success)"
                            : "var(--status-warning)"
                          : "var(--text-high)",
                      }}
                    >
                      {value}
                    </span>
                  </div>
                ))}
              </div>

              {/* Extractors */}
              {detail.extractors.length > 0 && (
                <div>
                  <p className="text-ui-xs mb-2 font-medium" style={{ color: "var(--text-mid)" }}>
                    Extractors
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {detail.extractors.map((ext) => (
                      <span
                        key={ext}
                        className="inline-flex items-center px-2 py-0.5 rounded text-ui-xs font-mono border"
                        style={{
                          background: "color-mix(in srgb, var(--status-success) 12%, transparent)",
                          color: "var(--status-success)",
                          borderColor: "color-mix(in srgb, var(--status-success) 25%, transparent)",
                        }}
                      >
                        {ext}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Tags */}
              <div>
                <p
                  className="text-ui-xs mb-2 font-medium flex items-center gap-1"
                  style={{ color: "var(--text-mid)" }}
                >
                  <TagIcon size={11} />
                  Tags
                </p>
                <SnapshotTagSection snapshotId={detail.id} />
              </div>

              {/* Archive results */}
              {detail.archiveResults.length > 0 && (
                <div>
                  <p className="text-ui-xs mb-2 font-medium" style={{ color: "var(--text-mid)" }}>
                    Archive Results
                  </p>
                  <div className="flex flex-col gap-2">
                    {detail.archiveResults.map((r) => (
                      <ArchiveResultSection key={r.id} result={r} snapshotId={detail.id} />
                    ))}
                  </div>
                </div>
              )}

              {/* Delete */}
              <div className="pt-3" style={{ borderTop: "1px solid var(--border-default)" }}>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-ui-xs font-medium cursor-pointer disabled:opacity-50 transition-colors"
                  style={{
                    background: "color-mix(in srgb, var(--status-danger) 10%, transparent)",
                    borderColor: "color-mix(in srgb, var(--status-danger) 30%, transparent)",
                    color: "var(--status-danger)",
                  }}
                >
                  <Trash2 size={12} />
                  {deleting ? "Deleting…" : "Delete snapshot"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
