import { WebFrostError } from "@webfrost/sdk";
import type { ImportRecord, ImportResult } from "@webfrost/sdk";
import { CheckCircle, Clock, FileText, Globe, History, Link, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "../components";
import { useClient } from "../context";

// ─── Types ────────────────────────────────────────────────────────────────────

type ImportType = "rss" | "opml" | "netscape" | "text";
type TabId = "import" | "history";

// ─── Constants ────────────────────────────────────────────────────────────────

const IMPORT_TYPES: { id: ImportType; label: string; icon: React.ReactNode; hint: string }[] = [
  {
    id: "rss",
    label: "RSS / Atom",
    icon: <Globe size={14} />,
    hint: "Paste a feed URL to import all linked articles",
  },
  {
    id: "opml",
    label: "OPML File",
    icon: <FileText size={14} />,
    hint: "Import a list of feeds from an OPML file",
  },
  {
    id: "netscape",
    label: "Bookmarks HTML",
    icon: <Link size={14} />,
    hint: "Import from browser bookmarks HTML export",
  },
  {
    id: "text",
    label: "Plain Text URLs",
    icon: <FileText size={14} />,
    hint: "One URL per line",
  },
];

const FORMAT_LABELS: Record<string, string> = {
  rss: "RSS / Atom",
  opml: "OPML File",
  netscape: "Bookmarks HTML",
  text: "Plain Text URLs",
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function relativeTime(val: string): string {
  const diff = Date.now() - new Date(val).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return new Date(val).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function ImportSuccessCard({
  result,
  onReset,
}: {
  result: ImportResult;
  onReset: () => void;
}) {
  return (
    <div
      style={{
        background: "color-mix(in srgb, var(--status-success) 8%, var(--bg-surface))",
        border: "1px solid color-mix(in srgb, var(--status-success) 30%, transparent)",
        borderRadius: 10,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <CheckCircle size={18} style={{ color: "var(--status-success)", flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-high)" }}>
            Import complete
          </div>
          <div style={{ fontSize: 12, color: "var(--text-mid)", marginTop: 2 }}>
            Format detected: {FORMAT_LABELS[result.format] ?? result.format}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 12,
        }}
      >
        {[
          { label: "Total found", value: result.total },
          { label: "Queued", value: result.queued, color: "var(--status-success)" },
          { label: "Skipped", value: result.skipped, color: "var(--text-mid)" },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            style={{
              background: "var(--bg-overlay)",
              borderRadius: 8,
              padding: "10px 12px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: color ?? "var(--text-high)",
                lineHeight: 1,
              }}
            >
              {value}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-low)", marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>

      {result.queued > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "var(--text-mid)",
          }}
        >
          <Clock size={12} />
          {result.queued} URL{result.queued !== 1 ? "s" : ""} queued for archiving.{" "}
          <RouterLink to="/snapshots" style={{ color: "var(--accent)", fontWeight: 500 }}>
            View snapshots →
          </RouterLink>
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="secondary" size="sm" onClick={onReset}>
          Import more
        </Button>
      </div>
    </div>
  );
}

function ImportForm({ onSuccess }: { onSuccess: (r: ImportResult) => void }) {
  const client = useClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importType, setImportType] = useState<ImportType>("rss");
  const [rssUrl, setRssUrl] = useState("");
  const [textContent, setTextContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      let res: ImportResult;
      if (importType === "rss") {
        res = await client.importUrls({ url: rssUrl.trim(), format: "rss" });
      } else if (importType === "text") {
        res = await client.importUrls({ content: textContent, format: "text" });
      } else {
        const file = fileInputRef.current?.files?.[0];
        if (!file) {
          setError("Please select a file.");
          setSubmitting(false);
          return;
        }
        const content = await file.text();
        res = await client.importUrls({ content, format: importType });
      }
      setRssUrl("");
      setTextContent("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      onSuccess(res);
    } catch (err) {
      setError(err instanceof WebFrostError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const activeType = IMPORT_TYPES.find((t) => t.id === importType) ?? IMPORT_TYPES[0];

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    border: "1px solid var(--border-default)",
    borderRadius: 6,
    fontSize: 13,
    background: "var(--bg-surface)",
    color: "var(--text-high)",
    outline: "none",
    boxSizing: "border-box",
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Type picker */}
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text-low)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: 8,
          }}
        >
          Format
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {IMPORT_TYPES.map(({ id, label, icon }) => {
            const active = importType === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setImportType(id);
                  setError(null);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: active ? "1px solid var(--accent)" : "1px solid var(--border-default)",
                  background: active
                    ? "color-mix(in srgb, var(--accent) 10%, transparent)"
                    : "var(--bg-surface)",
                  color: active ? "var(--accent)" : "var(--text-mid)",
                  fontSize: 12,
                  fontWeight: active ? 600 : 400,
                  cursor: "pointer",
                  transition: "all 120ms",
                }}
              >
                {icon}
                {label}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-low)", marginTop: 6 }}>
          {activeType.hint}
        </div>
      </div>

      {/* Input field */}
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text-low)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: 8,
          }}
        >
          {importType === "rss"
            ? "Feed URL"
            : importType === "text"
              ? "URLs"
              : importType === "opml"
                ? "OPML File"
                : "Bookmarks File"}
        </div>

        {importType === "rss" && (
          <input
            type="url"
            placeholder="https://example.com/feed.xml"
            value={rssUrl}
            onChange={(e) => setRssUrl(e.target.value)}
            required
            style={inputStyle}
          />
        )}

        {importType === "text" && (
          <textarea
            placeholder={"https://example.com\nhttps://another.com"}
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            required
            rows={8}
            style={{
              ...inputStyle,
              fontFamily: "ui-monospace, monospace",
              fontSize: 12,
              resize: "vertical",
            }}
          />
        )}

        {(importType === "opml" || importType === "netscape") && (
          <input
            ref={fileInputRef}
            type="file"
            accept={importType === "opml" ? ".opml,.xml" : ".html,.htm"}
            required
            style={{
              ...inputStyle,
              padding: "6px 8px",
              cursor: "pointer",
              color: "var(--text-mid)",
            }}
          />
        )}
      </div>

      {error && (
        <div
          style={{
            fontSize: 13,
            color: "var(--status-danger)",
            background: "color-mix(in srgb, var(--status-danger) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--status-danger) 25%, transparent)",
            borderRadius: 6,
            padding: "8px 12px",
          }}
        >
          {error}
        </div>
      )}

      <div>
        <Button variant="primary" size="md" type="submit" disabled={submitting}>
          <Upload size={14} />
          {submitting ? "Importing…" : "Import"}
        </Button>
      </div>
    </form>
  );
}

// ─── History tab ──────────────────────────────────────────────────────────────

function HistoryTab() {
  const client = useClient();
  const [records, setRecords] = useState<ImportRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await client.listImports();
      setRecords(data.slice().reverse()); // newest first
    } catch (e) {
      toast.error(e instanceof WebFrostError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              height: 44,
              borderRadius: 6,
              background: "var(--bg-overlay)",
              opacity: 0.6,
            }}
          />
        ))}
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          padding: "48px 0",
          color: "var(--text-low)",
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: "var(--bg-overlay)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <History size={20} style={{ color: "var(--text-low)" }} />
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-mid)" }}>
            No imports yet
          </div>
          <div style={{ fontSize: 13, color: "var(--text-low)", marginTop: 4 }}>
            Your past imports will appear here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-default)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr
            style={{
              background: "var(--bg-overlay)",
              borderBottom: "1px solid var(--border-default)",
            }}
          >
            {["When", "Source", "Format", "Queued", "Skipped"].map((h) => (
              <th
                key={h}
                style={{
                  padding: "8px 12px",
                  textAlign: "left",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--text-low)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr
              key={r.id}
              style={{ borderBottom: "1px solid var(--border-default)" }}
              className="hover:bg-subtle"
            >
              <td
                style={{
                  padding: "10px 12px",
                  fontSize: 12,
                  color: "var(--text-mid)",
                  whiteSpace: "nowrap",
                }}
                title={new Date(r.createdAt).toLocaleString()}
              >
                {relativeTime(r.createdAt)}
              </td>
              <td
                style={{
                  padding: "10px 12px",
                  fontSize: 12,
                  color: "var(--text-high)",
                  maxWidth: 260,
                }}
              >
                {r.sourceUrl ? (
                  <a
                    href={r.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    title={r.sourceUrl}
                    style={{
                      color: "var(--accent)",
                      textDecoration: "none",
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.sourceUrl}
                  </a>
                ) : (
                  <span style={{ color: "var(--text-low)", fontStyle: "italic" }}>file upload</span>
                )}
              </td>
              <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-mid)" }}>
                {FORMAT_LABELS[r.format] ?? r.format}
              </td>
              <td
                style={{
                  padding: "10px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  color: r.queued > 0 ? "var(--status-success)" : "var(--text-low)",
                }}
              >
                {r.queued}
              </td>
              <td
                style={{
                  padding: "10px 12px",
                  fontSize: 12,
                  color: "var(--text-low)",
                }}
              >
                {r.skipped}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export function ImportPage() {
  const [activeTab, setActiveTab] = useState<TabId>("import");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  function handleSuccess(result: ImportResult) {
    setImportResult(result);
    // Switch to history tab briefly to show it updated
  }

  function handleReset() {
    setImportResult(null);
  }

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "import", label: "Import", icon: <Upload size={13} /> },
    { id: "history", label: "History", icon: <History size={13} /> },
  ];

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <Upload size={20} style={{ color: "var(--accent)" }} />
        <h1
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 600,
            color: "var(--text-high)",
            lineHeight: 1.2,
          }}
        >
          Import URLs
        </h1>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 2,
          borderBottom: "1px solid var(--border-default)",
          marginBottom: 24,
        }}
      >
        {tabs.map(({ id, label, icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                setActiveTab(id);
                if (id === "import" && importResult) handleReset();
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                background: "none",
                border: "none",
                borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
                color: active ? "var(--accent)" : "var(--text-mid)",
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                cursor: "pointer",
                marginBottom: -1,
                transition: "color 120ms",
              }}
            >
              {icon}
              {label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {activeTab === "import" && (
        <div>
          {importResult ? (
            <ImportSuccessCard result={importResult} onReset={handleReset} />
          ) : (
            <ImportForm onSuccess={handleSuccess} />
          )}
        </div>
      )}

      {activeTab === "history" && <HistoryTab />}
    </main>
  );
}
