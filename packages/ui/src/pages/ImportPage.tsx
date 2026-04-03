import { WebFrostError } from "@webfrost/sdk";
import type { ImportResult } from "@webfrost/sdk";
import { useRef, useState } from "react";
import { useClient } from "../context";

type ImportType = "rss" | "opml" | "netscape" | "text";

const IMPORT_TYPES: { id: ImportType; label: string }[] = [
  { id: "rss", label: "RSS Feed URL" },
  { id: "opml", label: "OPML File" },
  { id: "netscape", label: "Bookmarks HTML" },
  { id: "text", label: "Plain Text URLs" },
];

const inputCls =
  "w-full py-2 px-3 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500";
const labelCls = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";

export function ImportPage() {
  const client = useClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [importType, setImportType] = useState<ImportType>("rss");
  const [rssUrl, setRssUrl] = useState("");
  const [textContent, setTextContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);

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
          return;
        }
        const content = await file.text();
        res = await client.importUrls({ content, format: importType });
      }

      setResult(res);
      // Reset form
      setRssUrl("");
      setTextContent("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setError(err instanceof WebFrostError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="max-w-[760px] mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold mb-6 text-gray-900 dark:text-gray-100">Import URLs</h1>

      <div className="flex gap-2 mb-6 flex-wrap">
        {IMPORT_TYPES.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setImportType(id);
              setError(null);
              setResult(null);
            }}
            className={`py-1.5 px-4 rounded border text-sm font-medium cursor-pointer transition-colors ${
              importType === id
                ? "bg-primary text-white border-primary"
                : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-primary"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {importType === "rss" && (
          <div>
            <label htmlFor="rss-url" className={labelCls}>
              Feed URL
            </label>
            <input
              id="rss-url"
              type="url"
              placeholder="https://example.com/feed.xml"
              value={rssUrl}
              onChange={(e) => setRssUrl(e.target.value)}
              required
              className={inputCls}
            />
          </div>
        )}

        {(importType === "opml" || importType === "netscape") && (
          <div>
            <label htmlFor="file-upload" className={labelCls}>
              {importType === "opml" ? "OPML File" : "Bookmarks HTML File"}
            </label>
            <input
              id="file-upload"
              ref={fileInputRef}
              type="file"
              accept={importType === "opml" ? ".opml,.xml" : ".html,.htm"}
              required
              className="w-full text-sm text-gray-700 dark:text-gray-300 file:mr-3 file:py-1.5 file:px-4 file:rounded file:border file:border-gray-300 dark:file:border-gray-600 file:text-sm file:bg-white dark:file:bg-gray-800 file:cursor-pointer file:text-gray-700 dark:file:text-gray-300"
            />
          </div>
        )}

        {importType === "text" && (
          <div>
            <label htmlFor="text-urls" className={labelCls}>
              URLs (one per line)
            </label>
            <textarea
              id="text-urls"
              placeholder={"https://example.com\nhttps://another.com"}
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
              required
              rows={8}
              className={`${inputCls} resize-y font-mono`}
            />
          </div>
        )}

        {error && (
          <p className="text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/20 py-2.5 px-3.5 rounded text-sm">
            {error}
          </p>
        )}

        {result && (
          <div className="rounded border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 p-4 text-sm text-green-800 dark:text-green-300">
            <p className="font-semibold mb-1">Import complete</p>
            <ul className="list-none p-0 m-0 flex flex-col gap-0.5">
              <li>Queued: {result.queued}</li>
              <li>Skipped (already archived): {result.skipped}</li>
              <li>Total found: {result.total}</li>
              <li>Format detected: {result.format}</li>
            </ul>
          </div>
        )}

        <div>
          <button
            type="submit"
            disabled={submitting}
            className={`py-2 px-6 bg-primary text-white border-0 rounded font-semibold text-sm ${
              submitting ? "cursor-not-allowed opacity-70" : "cursor-pointer"
            }`}
          >
            {submitting ? "Importing…" : "Import"}
          </button>
        </div>
      </form>
    </main>
  );
}
