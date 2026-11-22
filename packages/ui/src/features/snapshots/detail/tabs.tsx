import { useQuery } from "@tanstack/react-query";
import type { ArchiveResult } from "@webfrost/sdk";
import { Clock, Download, RefreshCcw, ZoomIn, ZoomOut } from "lucide-react";
import { type RefObject, useState } from "react";
import { useClient } from "../../../context";
import { useThemeContext } from "../../../context/theme";
import { snapshotKeys } from "../../../hooks/useSnapshots";
import { shortDateTime } from "../../../lib/format";
import { parseReadability, splitParagraphs } from "../../../lib/readability";

export function findResult(results: ArchiveResult[], extractor: string) {
  return results.find((r) => r.extractor === extractor);
}

export function TabEmpty({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-16 text-center text-mid">
      <p className="m-0 text-ui-sm">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-transparent px-3 py-1.5 text-ui-xs text-mid hover:bg-subtle hover:text-high"
        >
          <RefreshCcw size={12} aria-hidden="true" />
          Retry
        </button>
      )}
    </div>
  );
}

const iconBtn =
  "inline-flex rounded border-0 bg-transparent p-1 text-mid transition-colors hover:bg-subtle hover:text-high";
const toolbar = "flex shrink-0 items-center gap-2 border-b border-border px-3 py-2";
const downloadLink =
  "inline-flex items-center gap-1 text-ui-xs text-mid no-underline hover:text-high hover:no-underline";

// ─── Reader ───────────────────────────────────────────────────

export function ReaderTab({ result }: { result: ArchiveResult | undefined }) {
  if (!result?.content) {
    return <TabEmpty message="Readability extractor has no content for this snapshot." />;
  }
  const parsed = parseReadability(result.content);
  if (!parsed) return <TabEmpty message="Could not parse readability content." />;

  const paragraphs = parsed.textContent ? splitParagraphs(parsed.textContent) : [];
  return (
    <div className="h-full overflow-y-auto p-5">
      {parsed.title && (
        <h2 className="mb-1 mt-0 text-ui-xl font-semibold leading-snug text-high">
          {parsed.title}
        </h2>
      )}
      {parsed.byline && <p className="mb-4 mt-0 text-ui-xs text-mid">{parsed.byline}</p>}
      {paragraphs.length > 0 ? (
        <div className="text-content text-ui-base text-high">
          {paragraphs.map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static paragraph list derived from plain text
            <p key={i} className="mb-3 mt-0 whitespace-pre-line">
              {p}
            </p>
          ))}
        </div>
      ) : parsed.excerpt ? (
        <p className="text-content text-ui-base text-high">{parsed.excerpt}</p>
      ) : (
        <TabEmpty message="No readable content extracted." />
      )}
    </div>
  );
}

// ─── Screenshot ───────────────────────────────────────────────

export function ScreenshotTab({ result }: { result: ArchiveResult | undefined }) {
  const [zoom, setZoom] = useState(1);
  if (!result) return <TabEmpty message="Screenshot extractor did not run or failed." />;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className={toolbar}>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
          className={iconBtn}
          aria-label="Zoom out"
        >
          <ZoomOut size={14} aria-hidden="true" />
        </button>
        <span className="w-10 text-center text-ui-xs tabular-nums text-mid" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
          className={iconBtn}
          aria-label="Zoom in"
        >
          <ZoomIn size={14} aria-hidden="true" />
        </button>
        <a
          href={result.downloadUrl}
          target="_blank"
          rel="noreferrer"
          className={`ml-auto ${downloadLink}`}
        >
          <Download size={12} aria-hidden="true" /> Download
        </a>
      </div>
      <div className="flex-1 overflow-auto bg-overlay p-4">
        <img
          src={result.downloadUrl}
          alt="Page screenshot"
          className="block max-w-none origin-top-left"
          style={{ transform: `scale(${zoom})` }}
        />
      </div>
    </div>
  );
}

// ─── Page (SingleFile / DOM) ──────────────────────────────────

/** The archived page the viewer shows: SingleFile when there is one, else the DOM snapshot. */
export function pageResult(results: ArchiveResult[]) {
  // SingleFile has its CSS and images inlined, so it survives the preview's
  // "nothing from the network" policy; the raw DOM snapshot renders unstyled.
  return findResult(results, "singlefile") ?? findResult(results, "dom-snapshot");
}

export function PageTab({
  results,
  frameRef,
}: { results: ArchiveResult[]; frameRef?: RefObject<HTMLIFrameElement> }) {
  const shown = pageResult(results);
  // The frame's color-scheme is what the archived page sees as prefers-color-scheme: a page
  // whose CSS has a dark mode follows the app's theme, whichever theme it was archived in.
  const { theme } = useThemeContext();
  if (!shown) {
    return (
      <TabEmpty message="No archived page: the SingleFile and DOM extractors did not run or failed." />
    );
  }
  // Untrusted archived HTML: served by the sandboxed preview endpoint (CSP sandbox) and framed
  // with sandbox="". Never add allow-scripts / allow-same-origin here: together they would let an
  // archived page act as the signed-in user. The white background is the page's own canvas.
  return (
    <iframe
      ref={frameRef}
      src={shown.previewUrl ?? undefined}
      title="Archived page preview"
      sandbox=""
      allowFullScreen
      style={{ colorScheme: theme }}
      className="size-full border-0 bg-white"
    />
  );
}

// ─── Media ────────────────────────────────────────────────────

const MEDIA_FIELDS = ["title", "uploader", "duration", "view_count", "description"] as const;

export function MediaTab({
  snapshotId,
  results,
}: { snapshotId: number; results: ArchiveResult[] }) {
  const client = useClient();
  const media = findResult(results, "media");
  const meta = findResult(results, "media-metadata");

  // The metadata is a file-backed result, so the JSON itself comes from its download.
  const { data: metadata } = useQuery({
    queryKey: [...snapshotKeys.all, "media-metadata", snapshotId],
    enabled: Boolean(media && meta),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const res = await client.downloadArchive(snapshotId, "media-metadata");
      return (await res.json()) as Record<string, unknown>;
    },
  });

  if (!media) return <TabEmpty message="Media extractor did not run or no media found." />;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-5">
      {/* biome-ignore lint/a11y/useMediaCaption: archived media has no caption track to offer */}
      <video
        controls
        preload="metadata"
        src={media.downloadUrl}
        // The whole video fits under the viewer bar, whatever its shape.
        className="mx-auto max-h-[calc(100dvh-10rem)] w-full rounded-lg bg-black object-contain"
      >
        Your browser does not support video playback.
      </video>
      {metadata && (
        <dl className="m-0 overflow-hidden rounded-lg border border-border text-ui-xs">
          {MEDIA_FIELDS.map((k) => {
            const val = metadata[k];
            if (val == null) return null;
            return (
              <div key={k} className="flex gap-3 border-b border-border px-3 py-2 last:border-b-0">
                <dt className="w-[4.5rem] shrink-0 capitalize text-mid">{k.replace(/_/g, " ")}</dt>
                <dd className="m-0 truncate text-high">{String(val)}</dd>
              </div>
            );
          })}
        </dl>
      )}
      <a href={media.downloadUrl} download className="inline-flex items-center gap-1.5 text-ui-xs">
        <Download size={12} aria-hidden="true" /> Download media file
      </a>
    </div>
  );
}

// ─── Raw ──────────────────────────────────────────────────────

const DOWNLOADABLE = [
  { extractor: "html", label: "HTML" },
  { extractor: "warc", label: "WARC" },
  { extractor: "pdf", label: "PDF" },
  { extractor: "singlefile", label: "SingleFile HTML" },
  { extractor: "dom-snapshot", label: "DOM Snapshot" },
];

export function RawTab({ results }: { results: ArchiveResult[] }) {
  const available = DOWNLOADABLE.flatMap(({ extractor, label }) => {
    const result = findResult(results, extractor);
    return result ? [{ extractor, label, href: result.downloadUrl }] : [];
  });
  if (available.length === 0) {
    return <TabEmpty message="No downloadable archive files for this snapshot." />;
  }
  return (
    <div className="flex flex-col gap-2 p-5">
      {available.map(({ extractor, label, href }) => (
        <a
          key={extractor}
          href={href}
          download
          className="flex items-center justify-between rounded-lg border border-border bg-overlay px-4 py-3 text-high no-underline transition-colors hover:border-accent hover:no-underline"
        >
          <span className="text-ui-sm font-medium">{label}</span>
          <Download size={14} className="text-mid" aria-hidden="true" />
        </a>
      ))}
    </div>
  );
}

// ─── History ──────────────────────────────────────────────────

export function HistoryTab({ results }: { results: ArchiveResult[] }) {
  if (results.length === 0) return <TabEmpty message="No archive results yet." />;
  const sorted = [...results].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return (
    <ul className="m-0 flex h-full list-none flex-col divide-y divide-border overflow-y-auto p-0">
      {sorted.map((r) => (
        <li key={r.id} className="flex items-center gap-3 px-4 py-3">
          {/* The API lists captured results only; failures are in extractorMeta. */}
          <span
            className="size-2 shrink-0 rounded-full bg-success"
            role="img"
            aria-label="Captured"
          />
          <span className="min-w-0 flex-1 font-mono text-ui-xs text-high">{r.extractor}</span>
          <span className="flex shrink-0 items-center gap-1 text-ui-xs text-low">
            <Clock size={10} aria-hidden="true" />
            {shortDateTime(r.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}
