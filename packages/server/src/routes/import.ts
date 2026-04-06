import { homedir } from "node:os";
import { join } from "node:path";
import {
  createConcurrencyLimiter,
  createSnapshot,
  detectFormat,
  fetchRssFeedUrls,
  isUrlArchived,
  listImports,
  openDb,
  parseUrls,
  recordImport,
  runPipeline,
  safeFetch,
} from "@webfrost/core";
import { Elysia, t } from "elysia";
import { logger } from "../logger";

function getWebfrostDir(): string {
  return process.env.WEBFROST_DIR ?? join(homedir(), ".webfrost");
}

// Shared limiter for all background pipeline runs — bounded by WEBFROST_CONCURRENCY (default: 3)
const pipelineLimiter = createConcurrencyLimiter();

function getDb() {
  return openDb(getWebfrostDir());
}

type ImportFormat = "rss" | "opml" | "netscape" | "text";
const VALID_FORMATS: ReadonlyArray<string> = ["rss", "opml", "netscape", "text"];

function queueUrls(
  urls: string[],
  deduplicate: boolean,
  webfrostDir: string,
): { queued: number; skipped: number } {
  const db = getDb();
  let queued = 0;
  let skipped = 0;
  try {
    for (const url of urls) {
      if (deduplicate && isUrlArchived(db, url)) {
        skipped++;
        continue;
      }
      try {
        const snapshotId = createSnapshot(db, url);
        const pipelineLogger = logger.child({ snapshotId });
        pipelineLimiter
          .run(() => runPipeline(db, snapshotId, url, webfrostDir, undefined, pipelineLogger))
          .catch(() => {});
        queued++;
      } catch {
        // skip URLs that fail to enqueue
      }
    }
  } finally {
    db.close();
  }
  return { queued, skipped };
}

export const importRouter = new Elysia({ prefix: "/import" })
  .onError(({ code, set }) => {
    if (code === "VALIDATION") {
      set.status = 400;
      return { error: "invalid request" };
    }
    return undefined;
  })
  /**
   * POST /api/import
   *
   * Import URLs from a feed or raw content.
   *
   * Body (JSON):
   *   - url?: string       — URL of a feed/file to fetch and parse
   *   - content?: string   — Raw text content to parse (alternative to url)
   *   - format?: string    — One of "rss" | "opml" | "netscape" | "text" (auto-detected if omitted)
   *
   * RSS feeds deduplicate against already-archived URLs.
   * Returns 202 with { queued, skipped, total, format }.
   */
  .post(
    "/",
    async ({ body, set }) => {
      const { url: sourceUrl, content, format: formatHint } = body;
      const webfrostDir = getWebfrostDir();

      // Validate that at least one source is provided
      if (!sourceUrl && !content) {
        set.status = 400;
        return { error: "either url or content is required" };
      }

      // Fast path: fetch RSS feed by URL (SSRF-safe)
      if (sourceUrl && (formatHint === "rss" || !formatHint)) {
        // Attempt RSS parse first; if no articles found and format not forced, fall through
        let urls: string[];
        try {
          urls = await fetchRssFeedUrls(sourceUrl);
        } catch (err) {
          // If RSS fetch fails and format was explicitly rss, return error
          if (formatHint === "rss") {
            set.status = 400;
            return { error: err instanceof Error ? err.message : "failed to fetch RSS feed" };
          }
          urls = [];
        }
        if (urls.length > 0 || formatHint === "rss") {
          const { queued, skipped } = queueUrls(urls, true, webfrostDir);
          const db = getDb();
          try {
            recordImport(db, {
              id: crypto.randomUUID(),
              source_url: sourceUrl ?? null,
              format: "rss",
              queued,
              skipped,
            });
          } finally {
            db.close();
          }
          set.status = 202;
          return { queued, skipped, total: urls.length, format: "rss" };
        }
      }

      // General path: fetch from URL then parse
      let rawContent: string;
      let filename: string;
      if (sourceUrl) {
        let response: Response;
        try {
          response = await safeFetch(sourceUrl);
        } catch (err) {
          set.status = 400;
          return { error: err instanceof Error ? err.message : "failed to fetch url" };
        }
        if (!response.ok) {
          set.status = 400;
          return { error: `HTTP ${response.status} fetching ${sourceUrl}` };
        }
        rawContent = await response.text();
        filename = new URL(sourceUrl).pathname.split("/").pop() ?? "";
      } else {
        // biome-ignore lint/style/noNonNullAssertion: content is guaranteed non-null (validated above)
        rawContent = content!;
        filename = "";
      }

      const format: ImportFormat = VALID_FORMATS.includes(formatHint ?? "")
        ? (formatHint as ImportFormat)
        : detectFormat(filename, rawContent);

      const urls = parseUrls(rawContent, format);
      const { queued, skipped } = queueUrls(urls, format === "rss", webfrostDir);

      const db = getDb();
      try {
        recordImport(db, {
          id: crypto.randomUUID(),
          source_url: sourceUrl ?? null,
          format,
          queued,
          skipped,
        });
      } finally {
        db.close();
      }

      set.status = 202;
      return { queued, skipped, total: urls.length, format };
    },
    {
      body: t.Object({
        url: t.Optional(t.String()),
        content: t.Optional(t.String()),
        format: t.Optional(t.String()),
      }),
    },
  )
  /**
   * POST /api/import/file
   *
   * Import URLs from an uploaded file (OPML, Netscape bookmarks, RSS, or plain text).
   *
   * Body (multipart/form-data):
   *   - file: File  — The file to import
   *   - format?: string — One of "rss" | "opml" | "netscape" | "text" (auto-detected from filename if omitted)
   *
   * Returns 202 with { queued, skipped, total, format }.
   */
  .post(
    "/file",
    async ({ body, set }) => {
      const { file, format: formatHint } = body;
      const webfrostDir = getWebfrostDir();

      const rawContent = await file.text();
      const filename = file.name ?? "";

      const format: ImportFormat = VALID_FORMATS.includes(formatHint ?? "")
        ? (formatHint as ImportFormat)
        : detectFormat(filename, rawContent);

      const urls = parseUrls(rawContent, format);
      const { queued, skipped } = queueUrls(urls, format === "rss", webfrostDir);

      const db = getDb();
      try {
        recordImport(db, {
          id: crypto.randomUUID(),
          source_url: null,
          format,
          queued,
          skipped,
        });
      } finally {
        db.close();
      }

      set.status = 202;
      return { queued, skipped, total: urls.length, format };
    },
    {
      body: t.Object({
        file: t.File(),
        format: t.Optional(t.String()),
      }),
    },
  );

export const importsRouter = new Elysia({ prefix: "/imports" }).get("/", () => {
  const db = getDb();
  try {
    return listImports(db).map((r) => ({
      id: r.id,
      sourceUrl: r.source_url,
      format: r.format,
      queued: r.queued,
      skipped: r.skipped,
      createdAt: r.created_at,
    }));
  } finally {
    db.close();
  }
});
