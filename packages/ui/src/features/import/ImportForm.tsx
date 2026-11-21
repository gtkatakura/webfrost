import type { ImportResult } from "@webfrost/sdk";
import { FileText, Globe, Link, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { ErrorBanner } from "../../components/ui/StateViews";
import { UrlField } from "../../components/ui/UrlField";
import { useClient } from "../../context";
import { errorMessage } from "../../lib/errors";
import { normalizeUrl } from "../../lib/url";

export type ImportType = "rss" | "opml" | "netscape" | "text";

export const FORMAT_LABELS: Record<string, string> = {
  rss: "RSS / Atom",
  opml: "OPML File",
  netscape: "Bookmarks HTML",
  text: "Plain Text URLs",
};

const IMPORT_TYPES: { id: ImportType; icon: React.ReactNode; hint: string }[] = [
  { id: "rss", icon: <Globe size={14} />, hint: "Paste a feed URL to import all linked articles" },
  { id: "opml", icon: <FileText size={14} />, hint: "Import a list of feeds from an OPML file" },
  { id: "netscape", icon: <Link size={14} />, hint: "Import from browser bookmarks HTML export" },
  { id: "text", icon: <FileText size={14} />, hint: "One URL per line" },
];

const sectionLabel = "mb-2 text-ui-xs font-semibold tracking-wider text-mid uppercase";

export function ImportForm({ onSuccess }: { onSuccess: (r: ImportResult) => void }) {
  const client = useClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importType, setImportType] = useState<ImportType>("rss");
  const [rssUrl, setRssUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [textContent, setTextContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      let res: ImportResult;
      if (importType === "rss") {
        const url = normalizeUrl(rssUrl);
        if (!url.ok) {
          setUrlError(url.error);
          return;
        }
        setSubmitting(true);
        res = await client.importUrls({ url: url.url, format: "rss" });
      } else if (importType === "text") {
        setSubmitting(true);
        res = await client.importUrls({ content: textContent, format: "text" });
      } else {
        const file = fileInputRef.current?.files?.[0];
        if (!file) {
          setError("Please select a file.");
          return;
        }
        setSubmitting(true);
        res = await client.importUrls({ content: await file.text(), format: importType });
      }
      setRssUrl("");
      setTextContent("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      onSuccess(res);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const activeType = IMPORT_TYPES.find((t) => t.id === importType) ?? IMPORT_TYPES[0];
  const fieldLabel =
    importType === "rss"
      ? "Feed URL"
      : importType === "text"
        ? "URLs"
        : importType === "opml"
          ? "OPML File"
          : "Bookmarks File";

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      <div>
        <div className={sectionLabel} id="import-format">
          Format
        </div>
        <div role="group" aria-labelledby="import-format" className="flex flex-wrap gap-1.5">
          {IMPORT_TYPES.map(({ id, icon }) => {
            const active = importType === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setImportType(id);
                  setError(null);
                  setUrlError(null);
                }}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-ui-sm transition-colors ${
                  active
                    ? "border-accent bg-accent/10 font-semibold text-accent"
                    : "border-border bg-surface text-mid hover:border-border-strong hover:text-high"
                }`}
              >
                {icon}
                {FORMAT_LABELS[id]}
              </button>
            );
          })}
        </div>
        <p className="mb-0 mt-1.5 text-ui-sm text-mid">{activeType?.hint}</p>
      </div>

      <div>
        {importType === "rss" && (
          <UrlField
            label={fieldLabel}
            placeholder="https://example.com/feed.xml"
            value={rssUrl}
            onChange={(v) => {
              setRssUrl(v);
              setUrlError(null);
            }}
            error={urlError}
          />
        )}

        {importType === "text" && (
          <label className="flex flex-col gap-1 text-ui-sm font-medium text-mid">
            {fieldLabel}
            <textarea
              placeholder={"https://example.com\nhttps://another.com"}
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
              required
              rows={8}
              className="field resize-y font-mono"
            />
          </label>
        )}

        {(importType === "opml" || importType === "netscape") && (
          <label className="flex flex-col gap-1 text-ui-sm font-medium text-mid">
            {fieldLabel}
            <input
              ref={fileInputRef}
              type="file"
              accept={importType === "opml" ? ".opml,.xml" : ".html,.htm"}
              required
              className="field !p-1.5 text-mid"
            />
          </label>
        )}
      </div>

      {error && <ErrorBanner message={error} />}

      <div>
        <Button type="submit" size="lg" disabled={submitting}>
          <Upload size={14} aria-hidden="true" />
          {submitting ? "Importing…" : "Import"}
        </Button>
      </div>
    </form>
  );
}
