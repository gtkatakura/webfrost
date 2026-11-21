import {
  deleteSnapshot,
  getSnapshot,
  getSnapshotsByIds,
  listSnapshotsWithExtractorsPaginated,
  searchSnapshots,
} from "@webfrost/core";
import type { SnapshotWithExtractors, StorageBackend } from "@webfrost/core";
import { Elysia, t } from "elysia";
import { getDb, getRunner, getStorage } from "../context";
import { apiErrorHandler } from "../errors";
import { MAX_LIST_LIMIT, MAX_URL_LENGTH } from "../limits";
import { isGuestRequest } from "./auth";

/** List-level fields shared by the list, search and detail responses. */
function snapshotSummary(s: SnapshotWithExtractors) {
  return {
    status: s.status,
    createdAt: s.created_at,
    extractors: s.extractors,
    title: s.title,
    excerpt: s.excerpt,
    screenshotUrl: s.hasScreenshot ? `/api/snapshots/${s.id}/archives/screenshot/download` : null,
    tags: s.tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      slug: tag.slug,
      color: tag.color,
      createdAt: tag.created_at,
    })),
  };
}

// File-based extractors store a storage ref in content; derive file size via storage backend.
const FILE_BASED_EXTRACTORS = new Set([
  "warc",
  "pdf",
  "screenshot",
  "dom-snapshot",
  "singlefile",
  "media",
]);

// Every extractor whose `content` column holds a storage reference rather than the data itself.
const FILE_BACKED_EXTRACTORS = new Set([...FILE_BASED_EXTRACTORS, "media-metadata"]);

async function getFileSizeBytes(
  content: string | null,
  extractor: string,
  storage: StorageBackend,
): Promise<number | null> {
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
  "dom-snapshot",
  "singlefile",
  "media",
  "media-metadata",
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
  "dom-snapshot": { contentType: "text/html", filename: "dom.html" },
  singlefile: { contentType: "text/html", filename: "singlefile.html" },
  "media-metadata": { contentType: "application/json", filename: "media-metadata.json" },
};

export const snapshotsRouter = new Elysia({ prefix: "/snapshots" })
  .onError(apiErrorHandler)
  .post(
    "/",
    ({ body, set }) => {
      const { url } = body;

      // Validate HTTP/HTTPS URL
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        set.status = 400;
        return { error: "invalid url" };
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        set.status = 400;
        return { error: "invalid url" };
      }

      // The shared runner bounds concurrency (WEBFROST_CONCURRENCY) and gives the
      // pipeline its own DB connection, so the request connection closes right away.
      const db = getDb();
      let snapshotId: number;
      try {
        snapshotId = getRunner().add(db, url);
      } finally {
        db.close();
      }

      set.status = 202;
      return { id: snapshotId, url, status: "pending" };
    },
    {
      body: t.Object({ url: t.String({ maxLength: MAX_URL_LENGTH }) }),
      response: {
        202: t.Object({ id: t.Number(), url: t.String(), status: t.String() }),
        400: t.Object({ error: t.String(), code: t.Optional(t.String()) }),
      },
    },
  )
  .get(
    "/",
    ({ query }) => {
      const db = getDb();
      try {
        const q = query.q?.trim();
        // Whole numbers only: SQLite rejects a fractional LIMIT/OFFSET.
        const page = Math.max(1, Math.trunc(Number(query.page)) || 1);
        // Capped for everyone, guests included: one request must not dump the archive.
        const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, Math.trunc(Number(query.limit)) || 20));
        const status = query.status?.trim() || undefined;

        if (q) {
          // FTS5 ranked search — paginated hits with an HTML-safe snippet, plus the
          // same summary fields as the list so clients can filter and render without
          // a second request.
          const result = searchSnapshots(db, q, limit, page, status);
          const meta = getSnapshotsByIds(
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
                ...(snapshot ? snapshotSummary(snapshot) : {}),
              };
            }),
            total: result.total,
            page: result.page,
            limit: result.limit,
          };
        }

        const result = listSnapshotsWithExtractorsPaginated(db, page, limit, status);
        return {
          items: result.items.map((s) => ({ id: s.id, url: s.url, ...snapshotSummary(s) })),
          total: result.total,
          page: result.page,
          limit: result.limit,
        };
      } finally {
        db.close();
      }
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    },
  )
  .get(
    "/:id",
    async ({ params, set, request }) => {
      const id = Number(params.id);
      if (!Number.isInteger(id) || id <= 0) {
        set.status = 404;
        return { error: "not found" };
      }

      // For file-backed extractors `content` is a storage reference (an absolute
      // path or an S3 key). Anonymous visitors get the download URL instead.
      const guest = isGuestRequest(request);
      const db = getDb();
      const storage = getStorage();
      try {
        const snapshot = getSnapshot(db, id);
        if (!snapshot) {
          set.status = 404;
          return { error: "not found" };
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
                fileSizeBytes: await getFileSizeBytes(ar.content, ar.extractor, storage),
              };
            }
          }),
        );
        const summary = getSnapshotsByIds(db, [id]).get(id);
        return {
          id: snapshot.id,
          url: snapshot.url,
          status: snapshot.status,
          createdAt: snapshot.created_at,
          ...(summary ? snapshotSummary(summary) : {}),
          archiveResults: snapshot.archiveResults
            .filter((ar) => ar.error === null)
            .map((ar) => ({
              id: ar.id,
              extractor: ar.extractor,
              content:
                guest && ar.content !== null && FILE_BACKED_EXTRACTORS.has(ar.extractor)
                  ? `/api/snapshots/${id}/archives/${ar.extractor}/download`
                  : ar.content,
              createdAt: ar.created_at,
            })),
          extractorMeta,
        };
      } finally {
        db.close();
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
      if (!Number.isInteger(id) || id <= 0) {
        set.status = 404;
        return { error: "not found" };
      }

      const db = getDb();
      const storage = getStorage();
      try {
        const deleted = await deleteSnapshot(db, id, storage);
        if (!deleted) {
          set.status = 404;
          return { error: "not found" };
        }
        set.status = 204;
        return null;
      } finally {
        db.close();
      }
    },
    { params: t.Object({ id: t.String() }) },
  )
  .get(
    "/:id/archives/:extractor/preview",
    async ({ params, set }) => {
      const id = Number(params.id);
      const { extractor } = params;
      const fail = (status: number, error: string) => {
        set.status = status;
        return { error };
      };

      if (!Number.isInteger(id) || id <= 0) return fail(404, "not found");
      if (!PREVIEWABLE_EXTRACTORS.has(extractor)) return fail(400, "extractor has no preview");

      const db = getDb();
      let ref: string | null;
      try {
        ref =
          db
            .query<{ content: string | null }, [number, string]>(
              "SELECT content FROM archive_results WHERE snapshot_id = ? AND extractor = ? AND error IS NULL ORDER BY id DESC LIMIT 1",
            )
            .get(id, extractor)?.content ?? null;
      } finally {
        db.close();
      }
      if (!ref) return fail(404, "not found");

      const storage = getStorage();
      if (!storage.validateRef(ref)) return fail(403, "forbidden");
      if (!(await storage.fileExists(ref))) return fail(404, "file not found");
      const bytes = await storage.getBytes(ref);

      set.headers["content-type"] = "text/html; charset=utf-8";
      set.headers["content-security-policy"] = PREVIEW_CSP;
      set.headers["x-frame-options"] = "SAMEORIGIN";
      set.headers["referrer-policy"] = "no-referrer";
      set.headers["cache-control"] = "private, no-store";
      return new Response(bytes as unknown as BodyInit);
    },
    {
      params: t.Object({ id: t.String(), extractor: t.String() }),
    },
  )
  .get(
    "/:id/archives/:extractor/download",
    async ({ params, set }) => {
      const id = Number(params.id);
      const { extractor } = params;
      const fail = (status: number, error: string) => {
        set.status = status;
        return { error };
      };

      if (!Number.isInteger(id) || id <= 0) return fail(404, "not found");
      if (!ALLOWED_EXTRACTORS.has(extractor)) return fail(400, "unknown extractor");

      const db = getDb();
      let content: string | null = null;
      try {
        const row = db
          .query<{ content: string | null }, [number, string]>(
            "SELECT content FROM archive_results WHERE snapshot_id = ? AND extractor = ? AND error IS NULL ORDER BY id DESC LIMIT 1",
          )
          .get(id, extractor);
        if (!row) return fail(404, "not found");
        content = row.content;
      } finally {
        db.close();
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
      const bytes = await storage.getBytes(content);
      return new Response(bytes as unknown as BodyInit, {
        headers: { "Content-Type": file.contentType, "Content-Disposition": disposition },
      });
    },
    {
      params: t.Object({ id: t.String(), extractor: t.String() }),
    },
  );
