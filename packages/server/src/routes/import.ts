import {
  ImportLimitError,
  countImports,
  detectFormat,
  fetchGuarded,
  fetchRssFeedUrls,
  isUrlArchived,
  listImports,
  parseUrls,
  recordImport,
} from "@webfrost/core";
import { Elysia, t } from "elysia";
import { getDb, getRunner } from "../context";
import { apiError, apiErrorHandler } from "../errors";
import { MAX_URL_LENGTH, importMaxBytes, importMaxUrls } from "../limits";
import { isoTimestampRequired, pageParams } from "../serialize";

/** The 413 body for an import over a limit, or null when it is within them. */
function overLimit(urls: string[]): { error: string; code: "PAYLOAD_TOO_LARGE" } | null {
  const max = importMaxUrls();
  if (urls.length <= max) return null;
  // Parsing stops one URL past the cap, so `urls.length` is not the import's full size.
  return {
    error: `import has more than ${max} URLs; the limit is ${max} (WEBFROST_IMPORT_MAX_URLS)`,
    code: "PAYLOAD_TOO_LARGE",
  };
}

function tooLarge(): { error: string; code: "PAYLOAD_TOO_LARGE" } {
  return {
    error: `import is larger than ${importMaxBytes()} bytes (WEBFROST_IMPORT_MAX_BYTES)`,
    code: "PAYLOAD_TOO_LARGE",
  };
}

type ImportFormat = "rss" | "opml" | "netscape" | "text";
const VALID_FORMATS: ReadonlyArray<string> = ["rss", "opml", "netscape", "text"];

/**
 * Insert a snapshot for each URL and hand it to the shared background runner.
 *
 * The runner opens its own DB connection per pipeline, so the connection used
 * here to insert rows can be closed as soon as the loop ends. (Passing this
 * connection to the pipelines is what used to leave every imported snapshot
 * stuck in `pending`: it was closed before any of them ran.)
 */
async function queueUrls(
  urls: string[],
  deduplicate: boolean,
): Promise<{ queued: number; skipped: number }> {
  const runner = getRunner();
  const db = await getDb();
  let queued = 0;
  let skipped = 0;
  try {
    for (const url of urls) {
      if (deduplicate && (await isUrlArchived(db, url))) {
        skipped++;
        continue;
      }
      try {
        await runner.add(db, url);
        queued++;
      } catch {
        // skip URLs that fail to enqueue
        skipped++;
      }
    }
  } finally {
    await db.close();
  }
  return { queued, skipped };
}

export const importRouter = new Elysia({ prefix: "/import" })
  .onError(apiErrorHandler)
  /**
   * POST /api/v1/import
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

      // Validate that at least one source is provided
      if (!sourceUrl && !content) {
        return apiError(set, 400, "VALIDATION", "either url or content is required");
      }
      if (content && Buffer.byteLength(content, "utf8") > importMaxBytes()) {
        set.status = 413;
        return tooLarge();
      }

      // Fast path: fetch RSS feed by URL (SSRF-safe)
      if (sourceUrl && (formatHint === "rss" || !formatHint)) {
        // Attempt RSS parse first; if no articles found and format not forced, fall through
        let urls: string[];
        try {
          urls = await fetchRssFeedUrls(sourceUrl);
        } catch (err) {
          if (err instanceof ImportLimitError) {
            set.status = 413;
            return { error: err.message, code: "PAYLOAD_TOO_LARGE" as const };
          }
          // If RSS fetch fails and format was explicitly rss, return error
          if (formatHint === "rss") {
            return apiError(
              set,
              400,
              "FETCH_FAILED",
              err instanceof Error ? err.message : "failed to fetch RSS feed",
            );
          }
          urls = [];
        }
        if (urls.length > 0 || formatHint === "rss") {
          const refusal = overLimit(urls);
          if (refusal) {
            set.status = 413;
            return refusal;
          }
          const { queued, skipped } = await queueUrls(urls, true);
          const db = await getDb();
          try {
            await recordImport(db, {
              id: crypto.randomUUID(),
              source_url: sourceUrl ?? null,
              format: "rss",
              queued,
              skipped,
            });
          } finally {
            await db.close();
          }
          set.status = 202;
          return { queued, skipped, total: urls.length, format: "rss" };
        }
      }

      // General path: fetch from URL then parse
      let rawContent: string;
      let filename: string;
      let finalUrl: string | undefined;
      if (sourceUrl) {
        let response: Awaited<ReturnType<typeof fetchGuarded>>;
        try {
          response = await fetchGuarded(sourceUrl);
        } catch (err) {
          return apiError(
            set,
            400,
            "FETCH_FAILED",
            err instanceof Error ? err.message : "failed to fetch url",
          );
        }
        if (response.status < 200 || response.status >= 300) {
          return apiError(
            set,
            400,
            "FETCH_FAILED",
            `HTTP ${response.status} fetching ${sourceUrl}`,
          );
        }
        if (response.body.byteLength > importMaxBytes()) {
          set.status = 413;
          return tooLarge();
        }
        rawContent = new TextDecoder().decode(response.body);
        finalUrl = response.url;
        filename = new URL(sourceUrl).pathname.split("/").pop() ?? "";
      } else {
        // biome-ignore lint/style/noNonNullAssertion: content is guaranteed non-null (validated above)
        rawContent = content!;
        filename = "";
      }

      const format: ImportFormat = VALID_FORMATS.includes(formatHint ?? "")
        ? (formatHint as ImportFormat)
        : detectFormat(filename, rawContent);

      // Relative links in a fetched feed resolve against the URL it was finally served from.
      const urls = parseUrls(rawContent, format, finalUrl, { maxUrls: importMaxUrls() });
      const refusal = overLimit(urls);
      if (refusal) {
        set.status = 413;
        return refusal;
      }
      const { queued, skipped } = await queueUrls(urls, format === "rss");

      const db = await getDb();
      try {
        await recordImport(db, {
          id: crypto.randomUUID(),
          source_url: sourceUrl ?? null,
          format,
          queued,
          skipped,
        });
      } finally {
        await db.close();
      }

      set.status = 202;
      return { queued, skipped, total: urls.length, format };
    },
    {
      body: t.Object({
        url: t.Optional(t.String({ maxLength: MAX_URL_LENGTH })),
        content: t.Optional(t.String()),
        format: t.Optional(t.String({ maxLength: 16 })),
      }),
    },
  )
  /**
   * POST /api/v1/import/file
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

      if (file.size > importMaxBytes()) {
        set.status = 413;
        return tooLarge();
      }
      const rawContent = await file.text();
      const filename = file.name ?? "";

      const format: ImportFormat = VALID_FORMATS.includes(formatHint ?? "")
        ? (formatHint as ImportFormat)
        : detectFormat(filename, rawContent);

      const urls = parseUrls(rawContent, format, undefined, { maxUrls: importMaxUrls() });
      const refusal = overLimit(urls);
      if (refusal) {
        set.status = 413;
        return refusal;
      }
      const { queued, skipped } = await queueUrls(urls, format === "rss");

      const db = await getDb();
      try {
        await recordImport(db, {
          id: crypto.randomUUID(),
          source_url: null,
          format,
          queued,
          skipped,
        });
      } finally {
        await db.close();
      }

      set.status = 202;
      return { queued, skipped, total: urls.length, format };
    },
    {
      body: t.Object({
        file: t.File(),
        format: t.Optional(t.String({ maxLength: 16 })),
      }),
    },
  );

/** GET /api/v1/imports — the import history, newest first, in the list envelope. */
export const importsRouter = new Elysia({ prefix: "/imports" }).onError(apiErrorHandler).get(
  "/",
  async ({ query }) => {
    const { page, limit } = pageParams(query);
    const db = await getDb();
    try {
      const [rows, total] = await Promise.all([
        listImports(db, limit, (page - 1) * limit),
        countImports(db),
      ]);
      return {
        items: rows.map((r) => ({
          id: r.id,
          sourceUrl: r.source_url,
          format: r.format,
          queued: r.queued,
          skipped: r.skipped,
          createdAt: isoTimestampRequired(r.created_at),
        })),
        total,
        page,
        limit,
      };
    } finally {
      await db.close();
    }
  },
  { query: t.Object({ page: t.Optional(t.String()), limit: t.Optional(t.String()) }) },
);
