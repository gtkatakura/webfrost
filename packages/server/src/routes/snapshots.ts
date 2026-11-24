import {
  FAILURE_CATEGORIES,
  SnapshotBusyError,
  deleteSnapshot,
  getSnapshot,
  getSnapshotsByIds,
  isFailureCategory,
  listSnapshotsWithExtractorsPaginated,
  searchSnapshots,
  sql,
} from "@webfrost/core";
import type { Db, SnapshotFilter, SnapshotWithExtractors, StorageBackend } from "@webfrost/core";
import { Elysia, t } from "elysia";
import { getDb, getRunner, getStorage } from "../context";
import { apiError, apiErrorHandler } from "../errors";
import { MAX_URL_LENGTH } from "../limits";
import { isoTimestampRequired, pageParams, parseIsoTimestamp } from "../serialize";
import { API_PREFIX } from "../version";
import { isGuestRequest } from "./auth";
import { serializeTag } from "./tags";

/** Path of the v1 route that serves an archive result as a file. */
export function archiveDownloadPath(snapshotId: number, extractor: string): string {
  return `${API_PREFIX}/snapshots/${snapshotId}/archives/${extractor}/download`;
}

/** Path of the v1 route that renders an archive result as sandboxed HTML. */
export function archivePreviewPath(snapshotId: number, extractor: string): string {
  return `${API_PREFIX}/snapshots/${snapshotId}/archives/${extractor}/preview`;
}

/**
 * Why a failed snapshot failed: its category, what kind of failure that is and a label for people. The
 * raw message is left out for guests, as extractor errors are: it can name internal hosts.
 */
export function serializeFailure(
  category: string | null,
  detail: string | null,
  guest: boolean,
): { category: string; class: string; label: string; detail: string | null } | null {
  if (!category) return null;
  const known = isFailureCategory(category)
    ? FAILURE_CATEGORIES[category]
    : FAILURE_CATEGORIES.error;
  return {
    category,
    class: known.class,
    label: known.label,
    detail: guest ? null : detail,
  };
}

/** The most values one list filter takes (statuses, extractors or tags). */
const MAX_FILTER_VALUES = 20;
/** The longest text `contains` takes. */
const MAX_CONTAINS_LENGTH = 200;

/** A comma-separated query value as its parts, blanks dropped. */
function listParam(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

interface SnapshotFilterQuery {
  status?: string | undefined;
  since?: string | undefined;
  before?: string | undefined;
  extractor?: string | undefined;
  tag?: string | undefined;
  contains?: string | undefined;
}

/**
 * The filters of `GET /snapshots`, for the list and the search alike. They reach the database,
 * so they narrow the whole archive and `total` counts what is left. A value that cannot be read
 * is an error rather than a filter silently dropped: the caller would get far more than it asked.
 */
export function snapshotFilterFromQuery(
  query: SnapshotFilterQuery,
): { filter: SnapshotFilter } | { error: string } {
  const statuses = listParam(query.status);
  const extractors = listParam(query.extractor);
  const tags = listParam(query.tag);
  for (const [name, values] of [
    ["status", statuses],
    ["extractor", extractors],
    ["tag", tags],
  ] as const) {
    if (values.length > MAX_FILTER_VALUES) {
      return { error: `${name} takes at most ${MAX_FILTER_VALUES} values` };
    }
  }

  const tagIds: number[] = [];
  for (const tag of tags) {
    if (!/^[0-9]{1,15}$/.test(tag) || Number(tag) < 1) {
      return { error: "tag must be a tag id, or several separated by commas" };
    }
    tagIds.push(Number(tag));
  }

  const filter: SnapshotFilter = { statuses, extractors, tagIds };
  for (const name of ["since", "before"] as const) {
    const value = query[name]?.trim();
    if (!value) continue;
    const stored = parseIsoTimestamp(value);
    if (stored === null) return { error: `${name} must be an ISO 8601 date or timestamp` };
    filter[name] = stored;
  }
  const contains = query.contains?.trim();
  if (contains) filter.contains = contains;
  return { filter };
}

/**
 * True when the snapshot is in the trash and the visitor is anonymous (public read). The trash
 * hides a snapshot from everything a guest can list; its address must not keep serving it. Signed
 * in, it stays reachable: the Trash page links to it.
 */
export async function hiddenFromGuest(db: Db, id: number, request: Request): Promise<boolean> {
  if (!isGuestRequest(request)) return false;
  const row = await db.get<{ trashed_at: string | null }>(
    sql`SELECT trashed_at FROM snapshots WHERE id = ${id}`,
  );
  return row?.trashed_at != null;
}

/** List-level fields shared by the list, search and detail responses. */
function snapshotSummary(s: SnapshotWithExtractors, guest: boolean) {
  return {
    status: s.status,
    failure: serializeFailure(s.failure_category, s.failure_detail, guest),
    createdAt: isoTimestampRequired(s.created_at),
    extractors: s.extractors,
    title: s.title,
    excerpt: s.excerpt,
    // Lists show this as a thumbnail: the small JPEG when there is one, not a full page of several MB.
    // A video page is shown by a still of its video, then by the small thumbnail, then the full screenshot.
    screenshotUrl: s.hasPoster
      ? archiveDownloadPath(s.id, "media-poster")
      : s.hasThumbnail
        ? archiveDownloadPath(s.id, "thumbnail")
        : s.hasScreenshot
          ? archiveDownloadPath(s.id, "screenshot")
          : null,
    tags: s.tags.map(serializeTag),
  };
}

// File-based extractors store a storage ref in content; derive file size via storage backend.
const FILE_BASED_EXTRACTORS = new Set([
  "warc",
  "pdf",
  "screenshot",
  "thumbnail",
  "dom-snapshot",
  "singlefile",
  "media",
  "media-poster",
]);

// Every extractor whose `content` column holds a storage reference rather than the data itself.
/** Fields of yt-dlp's info JSON that the metadata download exposes; everything else stays on disk. */
const PUBLIC_MEDIA_METADATA_FIELDS = [
  "id",
  "title",
  "fulltitle",
  "description",
  "uploader",
  "channel",
  "duration",
  "view_count",
  "like_count",
  "upload_date",
  "timestamp",
  "webpage_url",
  "extractor",
  "extractor_key",
  "categories",
  "tags",
  "language",
  "ext",
  "width",
  "height",
] as const;

function publicMediaMetadata(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const source = parsed as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of PUBLIC_MEDIA_METADATA_FIELDS) if (key in source) out[key] = source[key];
  return out;
}

const FILE_BACKED_EXTRACTORS = new Set([...FILE_BASED_EXTRACTORS, "media-metadata"]);

async function getFileSizeBytes(
  storedSize: number | null,
  content: string | null,
  extractor: string,
  storage: StorageBackend,
): Promise<number | null> {
  if (storedSize !== null && storedSize !== undefined) return Number(storedSize);
  if (!content) return null;
  if (FILE_BACKED_EXTRACTORS.has(extractor)) {
    const size = await storage.fileSize(content);
    return size > 0 ? size : null;
  }
  return Buffer.byteLength(content, "utf8");
}

const ALLOWED_EXTRACTORS = new Set([
  "html",
  "warc",
  "pdf",
  "readability",
  "screenshot",
  "thumbnail",
  "dom-snapshot",
  "singlefile",
  "media",
  "media-metadata",
  "media-poster",
]);

/** What anonymous visitors see instead of an extractor's error message. */
const GUEST_EXTRACTOR_ERROR = "extraction failed";

/** Archived HTML formats that can be shown in the sandboxed preview. */
const PREVIEWABLE_EXTRACTORS = new Set(["dom-snapshot", "singlefile"]);

/**
 * Policy for rendering archived (untrusted) HTML inside the app.
 *
 * - `sandbox` gives the document an opaque origin and disables scripts, forms,
 *   popups and top-level navigation — even if the URL is opened directly, outside
 *   the iframe.
 * - Nothing may be loaded from the network: only inline styles and data: URIs,
 *   which is what the SingleFile extractor produces. That also keeps the archived
 *   page from phoning home when someone looks at it.
 * - Only this app may frame it.
 */
const PREVIEW_CSP =
  "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; frame-ancestors 'self'";

const FILE_EXTRACTORS: Record<string, { contentType: string; filename: string }> = {
  warc: { contentType: "application/warc", filename: "archive.warc" },
  pdf: { contentType: "application/pdf", filename: "page.pdf" },
  screenshot: { contentType: "image/png", filename: "screenshot.png" },
  thumbnail: { contentType: "image/webp", filename: "thumbnail.webp" },
  "media-poster": { contentType: "image/jpeg", filename: "poster.jpg" },
  "dom-snapshot": { contentType: "text/html", filename: "dom.html" },
  singlefile: { contentType: "text/html", filename: "singlefile.html" },
  "media-metadata": { contentType: "application/json", filename: "media-metadata.json" },
};

export const snapshotsRouter = new Elysia({ prefix: "/snapshots" })
  .onError(apiErrorHandler)
  .post(
    "/",
    async ({ body, set }) => {
      const { url, colorScheme } = body;

      // Validate HTTP/HTTPS URL
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return apiError(set, 400, "VALIDATION", "invalid url");
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return apiError(set, 400, "VALIDATION", "invalid url");
      }

      // The shared runner bounds concurrency (WEBFROST_CONCURRENCY) and gives the
      // pipeline its own DB connection, so the request connection closes right away.
      const db = await getDb();
      let snapshotId: number;
      try {
        snapshotId = await getRunner().add(db, url, { colorScheme });
      } finally {
        await db.close();
      }

      set.status = 202;
      return { id: snapshotId, url, status: "pending" };
    },
    {
      body: t.Object({
        url: t.String({ maxLength: MAX_URL_LENGTH }),
        // The theme the archiving browser uses; the web UI sends its own.
        colorScheme: t.Optional(t.Union([t.Literal("light"), t.Literal("dark")])),
      }),
      response: {
        202: t.Object({ id: t.Number(), url: t.String(), status: t.String() }),
        400: t.Object({ error: t.String(), code: t.String() }),
      },
    },
  )
  .get(
    "/",
    async ({ query, request, set }) => {
      const guest = isGuestRequest(request);
      const parsed = snapshotFilterFromQuery(query);
      if ("error" in parsed) return apiError(set, 400, "VALIDATION", parsed.error);
      const { filter } = parsed;
      const db = await getDb();
      try {
        const q = query.q?.trim();
        // Capped for everyone, guests included: one request must not dump the archive.
        const { page, limit } = pageParams(query);

        if (q) {
          // FTS5 ranked search — paginated hits with an HTML-safe snippet, plus the
          // same summary fields as the list so clients can filter and render without
          // a second request.
          const result = await searchSnapshots(db, q, limit, page, filter);
          const meta = await getSnapshotsByIds(
            db,
            result.items.map((r) => r.id),
          );
          return {
            items: result.items.map((r) => {
              const snapshot = meta.get(r.id);
              return {
                id: r.id,
                url: r.url,
                snippet: r.snippet,
                rank: r.rank,
                ...(snapshot ? snapshotSummary(snapshot, guest) : {}),
              };
            }),
            total: result.total,
            page: result.page,
            limit: result.limit,
          };
        }

        const result = await listSnapshotsWithExtractorsPaginated(db, page, limit, filter);
        return {
          items: result.items.map((s) => ({ id: s.id, url: s.url, ...snapshotSummary(s, guest) })),
          total: result.total,
          page: result.page,
          limit: result.limit,
        };
      } finally {
        await db.close();
      }
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        // Plain numbers only: "Infinity" or "1e400" would reach SQL as an invalid OFFSET.
        page: t.Optional(t.String({ pattern: "^(-?[0-9]{1,15}(\\.[0-9]{1,15})?)?$" })),
        limit: t.Optional(t.String({ pattern: "^(-?[0-9]{1,15}(\\.[0-9]{1,15})?)?$" })),
        // One value or several separated by commas: any of these statuses.
        status: t.Optional(t.String({ maxLength: 200 })),
        // Created at or after `since`, and before `before` (ISO 8601).
        since: t.Optional(t.String({ maxLength: 40 })),
        before: t.Optional(t.String({ maxLength: 40 })),
        // Every one of these extractors produced output.
        extractor: t.Optional(t.String({ maxLength: 400 })),
        // Carries every one of these tags (ids).
        tag: t.Optional(t.String({ maxLength: 400 })),
        // The URL or the title contains this text.
        contains: t.Optional(t.String({ maxLength: MAX_CONTAINS_LENGTH })),
      }),
    },
  )
  .get(
    "/:id",
    async ({ params, set, request }) => {
      const id = Number(params.id);
      if (!Number.isInteger(id) || id <= 0) return apiError(set, 404, "NOT_FOUND", "not found");

      const guest = isGuestRequest(request);
      const db = await getDb();
      const storage = getStorage();
      try {
        const snapshot = await getSnapshot(db, id);
        if (!snapshot || (guest && snapshot.trashed_at !== null)) {
          return apiError(set, 404, "NOT_FOUND", "not found");
        }
        const extractorMeta: Record<
          string,
          {
            status: string;
            durationMs: number | null;
            fileSizeBytes: number | null;
            error?: string;
          }
        > = {};
        await Promise.all(
          snapshot.archiveResults.map(async (ar) => {
            if (ar.error !== null) {
              extractorMeta[ar.extractor] = {
                status: "failed",
                durationMs: ar.duration_ms,
                fileSizeBytes: null,
                // Raw extractor errors can name internal hosts, paths and binaries.
                error: guest ? GUEST_EXTRACTOR_ERROR : ar.error,
              };
            } else {
              extractorMeta[ar.extractor] = {
                status: "success",
                durationMs: ar.duration_ms,
                fileSizeBytes: await getFileSizeBytes(
                  ar.size_bytes,
                  ar.content,
                  ar.extractor,
                  storage,
                ),
              };
            }
          }),
        );
        const summary = (await getSnapshotsByIds(db, [id])).get(id);
        return {
          id: snapshot.id,
          url: snapshot.url,
          status: snapshot.status,
          createdAt: isoTimestampRequired(snapshot.created_at),
          ...(summary ? snapshotSummary(summary, guest) : {}),
          archiveResults: snapshot.archiveResults
            .filter((ar) => ar.error === null)
            .map((ar) => ({
              id: ar.id,
              extractor: ar.extractor,
              // Inline results (readability JSON, html) carry their data. For file-backed ones
              // the column holds a storage path or S3 key, which never leaves the server:
              // clients fetch the file from downloadUrl.
              content: FILE_BACKED_EXTRACTORS.has(ar.extractor) ? null : ar.content,
              downloadUrl: archiveDownloadPath(id, ar.extractor),
              previewUrl: PREVIEWABLE_EXTRACTORS.has(ar.extractor)
                ? archivePreviewPath(id, ar.extractor)
                : null,
              createdAt: isoTimestampRequired(ar.created_at),
            })),
          extractorMeta,
        };
      } finally {
        await db.close();
      }
    },
    {
      params: t.Object({ id: t.String() }),
    },
  )
  .delete(
    "/:id",
    async ({ params, set }) => {
      const id = Number(params.id);
      if (!Number.isInteger(id) || id <= 0) return apiError(set, 404, "NOT_FOUND", "not found");

      const db = await getDb();
      const storage = getStorage();
      try {
        let deleted: boolean;
        try {
          deleted = await deleteSnapshot(db, id, storage);
        } catch (err) {
          if (err instanceof SnapshotBusyError) {
            return apiError(
              set,
              409,
              "CONFLICT",
              err.reason === "archiving"
                ? "snapshot is being archived"
                : "snapshot is being imported",
            );
          }
          throw err;
        }
        if (!deleted) return apiError(set, 404, "NOT_FOUND", "not found");
        set.status = 204;
        return null;
      } finally {
        await db.close();
      }
    },
    { params: t.Object({ id: t.String() }) },
  )
  .post(
    "/:id/retry",
    async ({ params, set }) => {
      const id = Number(params.id);
      if (!Number.isInteger(id) || id <= 0) return apiError(set, 404, "NOT_FOUND", "not found");
      // Archive the snapshot again in place: same id, URL and color scheme, results replaced.
      const db = await getDb();
      try {
        const outcome = await getRunner().retry(db, id);
        if (outcome === "missing") return apiError(set, 404, "NOT_FOUND", "not found");
        if (outcome === "busy") return apiError(set, 409, "CONFLICT", "snapshot is being archived");
      } finally {
        await db.close();
      }
      set.status = 202;
      return { id, status: "pending" };
    },
    { params: t.Object({ id: t.String() }) },
  )
  .get(
    "/:id/archives/:extractor/preview",
    async ({ params, set, request }) => {
      const id = Number(params.id);
      const { extractor } = params;
      const fail = (status: 400 | 403 | 404, error: string) =>
        apiError(
          set,
          status,
          status === 404 ? "NOT_FOUND" : status === 403 ? "FORBIDDEN" : "BAD_REQUEST",
          error,
        );

      if (!Number.isInteger(id) || id <= 0) return fail(404, "not found");
      if (!PREVIEWABLE_EXTRACTORS.has(extractor)) return fail(400, "extractor has no preview");

      const db = await getDb();
      let ref: string | null;
      try {
        if (await hiddenFromGuest(db, id, request)) return fail(404, "not found");
        const row = await db.get<{ content: string | null }>(
          sql`SELECT content FROM archive_results WHERE snapshot_id = ${id} AND extractor = ${extractor} AND error IS NULL ORDER BY id DESC LIMIT 1`,
        );
        ref = row?.content ?? null;
      } finally {
        await db.close();
      }
      if (!ref) return fail(404, "not found");

      const storage = getStorage();
      if (!storage.validateRef(ref)) return fail(403, "forbidden");
      if (!(await storage.fileExists(ref))) return fail(404, "file not found");

      set.headers["content-type"] = "text/html; charset=utf-8";
      set.headers["content-security-policy"] = PREVIEW_CSP;
      set.headers["x-frame-options"] = "SAMEORIGIN";
      set.headers["referrer-policy"] = "no-referrer";
      set.headers["cache-control"] = "private, no-store";
      // Streamed, never read whole into memory: SingleFile pages can be large.
      return new Response(storage.getStream(ref) as unknown as BodyInit);
    },
    {
      params: t.Object({ id: t.String(), extractor: t.String() }),
    },
  )
  .get(
    "/:id/archives/:extractor/download",
    async ({ params, set, request }) => {
      const id = Number(params.id);
      const { extractor } = params;
      const fail = (status: 400 | 403 | 404, error: string) =>
        apiError(
          set,
          status,
          status === 404 ? "NOT_FOUND" : status === 403 ? "FORBIDDEN" : "BAD_REQUEST",
          error,
        );

      if (!Number.isInteger(id) || id <= 0) return fail(404, "not found");
      if (!ALLOWED_EXTRACTORS.has(extractor)) return fail(400, "unknown extractor");

      const db = await getDb();
      let content: string | null = null;
      try {
        if (await hiddenFromGuest(db, id, request)) return fail(404, "not found");
        const row = await db.get<{ content: string | null }>(
          sql`SELECT content FROM archive_results WHERE snapshot_id = ${id} AND extractor = ${extractor} AND error IS NULL ORDER BY id DESC LIMIT 1`,
        );
        if (!row) return fail(404, "not found");
        content = row.content;
      } finally {
        await db.close();
      }

      if (!content) return fail(404, "no content");

      // Media files can be mp4 or mp3 depending on whether video or audio fallback was used.
      const isAudio = extractor === "media" && content.endsWith(".mp3");
      const file =
        extractor === "media"
          ? {
              contentType: isAudio ? "audio/mpeg" : "video/mp4",
              filename: isAudio ? "media.mp3" : "media.mp4",
            }
          : FILE_EXTRACTORS[extractor];

      if (!file) {
        // Inline extractors (readability JSON, html) keep their data in the database.
        return new Response(content, {
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": `attachment; filename="${extractor}.json"`,
          },
        });
      }

      const storage = getStorage();
      if (!storage.validateRef(content)) return fail(403, "forbidden");
      if (!(await storage.fileExists(content))) return fail(404, "file not found");

      const disposition = `attachment; filename="${file.filename}"`;
      // The media metadata JSON is read by the UI with fetch(), which may not follow
      // a redirect to the bucket's origin (connect-src 'self'); serve it from here.
      // Everything else is redirected to the bucket with the type and an attachment
      // disposition signed into the URL: archived HTML must never render inline on
      // the bucket's origin, where its scripts would run.
      const presignedUrl =
        extractor === "media-metadata"
          ? null
          : storage.presignedDownloadUrl(content, undefined, {
              contentType: file.contentType,
              contentDisposition: disposition,
            });
      if (presignedUrl) {
        return new Response(null, { status: 302, headers: { Location: presignedUrl } });
      }
      const headers: Record<string, string> = {
        "Content-Type": file.contentType,
        "Content-Disposition": disposition,
      };
      if (extractor === "media-metadata") {
        // yt-dlp's raw info JSON carries signed media URLs (with the server's egress IP),
        // request headers and more: only the display fields leave the server.
        const raw = new TextDecoder().decode(await storage.getBytes(content));
        return new Response(JSON.stringify(publicMediaMetadata(raw)), { headers });
      }
      // Streamed, never read whole into memory: media files run to hundreds of MB.
      const size = await storage.fileSize(content);
      if (size > 0) headers["Content-Length"] = String(size);
      return new Response(storage.getStream(content) as unknown as BodyInit, { headers });
    },
    {
      params: t.Object({ id: t.String(), extractor: t.String() }),
    },
  );
