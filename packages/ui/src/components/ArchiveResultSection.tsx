import type { SnapshotDetail } from "@webfrost/sdk";
import { useState } from "react";
import { ExtractorBadge } from "./ExtractorBadge";

type ArchiveResult = SnapshotDetail["archiveResults"][number];

interface ReadabilityContent {
  title?: string | null;
  byline?: string | null;
  textContent?: string | null;
  excerpt?: string | null;
}

function ReadabilityResult({
  result,
  downloadUrl,
}: {
  result: ArchiveResult;
  downloadUrl: string;
}) {
  let parsed: ReadabilityContent = {};
  try {
    parsed = JSON.parse(result.content ?? "") as ReadabilityContent;
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

function ScreenshotResult({ downloadUrl }: { downloadUrl: string }) {
  return (
    <div className="border border-gray-200 rounded-md p-4 mb-3">
      <div className="mb-2">
        <ExtractorBadge extractor="screenshot" hasContent={true} />
      </div>
      <a href={downloadUrl} target="_blank" rel="noreferrer" title="Open full size">
        <img
          src={downloadUrl}
          alt="Screenshot preview"
          className="max-w-full rounded border border-gray-200 cursor-pointer hover:opacity-90 transition-opacity"
          style={{ maxHeight: 320 }}
        />
      </a>
    </div>
  );
}

function SandboxedHtmlResult({
  extractor,
  downloadUrl,
  showRawToggle,
}: {
  extractor: string;
  downloadUrl: string;
  showRawToggle: boolean;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const [rawHtml, setRawHtml] = useState<string | null>(null);

  async function handleToggleRaw() {
    if (!showRaw && rawHtml === null) {
      const res = await fetch(downloadUrl);
      setRawHtml(await res.text());
    }
    setShowRaw((v) => !v);
  }

  return (
    <div className="border border-gray-200 rounded-md p-4 mb-3">
      <div className="mb-3 flex items-center gap-3">
        <ExtractorBadge extractor={extractor} hasContent={true} />
        <a href={downloadUrl} className="text-sm">
          Download
        </a>
        {showRawToggle && (
          <button
            type="button"
            onClick={handleToggleRaw}
            className="text-sm text-primary bg-transparent border-0 cursor-pointer p-0 underline"
          >
            {showRaw ? "Hide HTML" : "View HTML"}
          </button>
        )}
      </div>
      {showRaw && rawHtml !== null ? (
        <pre className="bg-gray-100 p-3 rounded text-[0.75rem] overflow-x-auto whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto m-0">
          {rawHtml}
        </pre>
      ) : (
        <iframe
          src={downloadUrl}
          // biome-ignore lint/security/noDangerouslySetInnerHtmlWithChildren: intentional sandboxed preview
          sandbox=""
          title={`${extractor} preview`}
          className="w-full border border-gray-200 rounded"
          style={{ height: 400 }}
        />
      )}
    </div>
  );
}

export function ArchiveResultSection({
  result,
  snapshotId,
}: {
  result: ArchiveResult;
  snapshotId: number;
}) {
  const downloadUrl = `/api/snapshots/${snapshotId}/archives/${result.extractor}/download`;

  if (result.extractor === "readability" && result.content) {
    return <ReadabilityResult result={result} downloadUrl={downloadUrl} />;
  }

  if (result.extractor === "screenshot" && result.content) {
    return <ScreenshotResult downloadUrl={downloadUrl} />;
  }

  if (
    (result.extractor === "dom-snapshot" || result.extractor === "singlefile") &&
    result.content
  ) {
    return (
      <SandboxedHtmlResult
        extractor={result.extractor}
        downloadUrl={downloadUrl}
        showRawToggle={result.extractor === "dom-snapshot"}
      />
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
