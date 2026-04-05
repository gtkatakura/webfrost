import { homedir } from "node:os";
import { join } from "node:path";
import {
  createSnapshot,
  createStorageBackend,
  deleteSnapshot,
  getSnapshot,
  listSnapshotsWithExtractorsPaginated,
  openDb,
  runPipeline,
  searchSnapshots,
} from "@webfrost/core";
import type { StorageBackend } from "@webfrost/core";
import { Elysia, t } from "elysia";
import { logger } from "../logger";
import { rateLimiterPlugin } from "../middleware/rateLimiter";

function getWebfrostDir(): string {
  return process.env.WEBFROST_DIR ?? join(homedir(), ".webfrost");
}

function getDb() {
  return openDb(getWebfrostDir());
}

function getStorage(): StorageBackend {
  return createStorageBackend(getWebfrostDir());
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

async function getFileSizeBytes(
  content: string | null,
  extractor: string,
  storage: StorageBackend,
): Promise<number | null> {
  if (!content) return null;
  if (FILE_BASED_EXTRACTORS.has(extractor)) {
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

const FILE_EXTRACTORS: Record<string, { contentType: string; filename: string }> = {
  warc: { contentType: "application/warc", filename: "archive.warc" },
  pdf: { contentType: "application/pdf", filename: "page.pdf" },
  screenshot: { contentType: "image/png", filename: "screenshot.png" },
  "dom-snapshot": { contentType: "text/html", filename: "dom.html" },
  singlefile: { contentType: "text/html", filename: "singlefile.html" },
  "media-metadata": { contentType: "application/json", filename: "media-metadata.json" },
};

export const snapshotsRouter = new Elysia({ prefix: "/snapshots" })
  // 60 req/min per IP for snapshot creation (write) to prevent pipeline abuse
  .use(rateLimiterPlugin({ limit: 60, windowMs: 60_000, methods: ["POST"] }))
  .onError(({ code, set }) => {
    if (code === "VALIDATION") {
      set.status = 400;
      return { error: "invalid url" };
    }
    return undefined;
  })
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

      const db = getDb();
      let snapshotId: number;
      try {
        snapshotId = createSnapshot(db, url);
      } finally {
        db.close();
      }

      // Fire and forget with its own DB connection so the request DB can close immediately
      const pipelineDb = getDb();
      const pipelineLogger = logger.child({ snapshotId });
      const storage = getStorage();
      runPipeline(pipelineDb, snapshotId, url, getWebfrostDir(), undefined, pipelineLogger, storage)
        .catch((err: unknown) => {
          pipelineLogger.error({ err }, "pipeline error");
        })
        .finally(() => pipelineDb.close());

      set.status = 202;
      return { id: snapshotId, url, status: "pending" };
    },
    {
      body: t.Object({ url: t.String() }),
      response: {
        202: t.Object({ id: t.Number(), url: t.String(), status: t.String() }),
        400: t.Object({ error: t.String() }),
      },
    },
  )
  .get(
    "/",
    ({ query }) => {
      const db = getDb();
      try {
        const q = query.q?.trim();
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(10000, Math.max(1, Number(query.limit) || 20));

        if (q) {
          // FTS5 ranked search — returns paginated results with snippet
          const result = searchSnapshots(db, q, limit, page);
          return {
            items: result.items.map((r) => ({
              id: r.id,
              url: r.url,
              snippet: r.snippet,
              rank: r.rank,
            })),
            total: result.total,
            page: result.page,
            limit: result.limit,
          };
        }

        const result = listSnapshotsWithExtractorsPaginated(db, page, limit);
        return {
          items: result.items.map((s) => ({
            id: s.id,
            url: s.url,
            status: s.status,
            createdAt: s.created_at,
            extractors: s.extractors,
            title: s.title,
            excerpt: s.excerpt,
            screenshotUrl: s.hasScreenshot
              ? `/api/snapshots/${s.id}/archives/screenshot/download`
              : null,
            tags: s.tags.map((tag) => ({
              id: tag.id,
              name: tag.name,
              slug: tag.slug,
              color: tag.color,
              createdAt: tag.created_at,
            })),
          })),
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
      }),
    },
  )
  .get(
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
                error: ar.error,
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
        return {
          id: snapshot.id,
          url: snapshot.url,
          status: snapshot.status,
          createdAt: snapshot.created_at,
          archiveResults: snapshot.archiveResults
            .filter((ar) => ar.error === null)
            .map((ar) => ({
              id: ar.id,
              extractor: ar.extractor,
              content: ar.content,
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
    "/:id/archives/:extractor/download",
    async ({ params, set }) => {
      const id = Number(params.id);
      const { extractor } = params;

      if (!Number.isInteger(id) || id <= 0) {
        set.status = 404;
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!ALLOWED_EXTRACTORS.has(extractor)) {
        return new Response(JSON.stringify({ error: "unknown extractor" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const db = getDb();
      let content: string | null = null;
      try {
        const row = db
          .query<{ content: string | null }, [number, string]>(
            "SELECT content FROM archive_results WHERE snapshot_id = ? AND extractor = ? LIMIT 1",
          )
          .get(id, extractor);
        if (!row) {
          return new Response(JSON.stringify({ error: "not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }
        content = row.content;
      } finally {
        db.close();
      }

      if (!content) {
        return new Response(JSON.stringify({ error: "no content" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      const storage = getStorage();

      // Media files can be mp4 or mp3 depending on whether video or audio fallback was used
      if (extractor === "media") {
        if (!storage.validateRef(content)) {
          return new Response(JSON.stringify({ error: "forbidden" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (!(await storage.fileExists(content))) {
          return new Response(JSON.stringify({ error: "file not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }
        const presignedUrl = storage.presignedDownloadUrl(content);
        if (presignedUrl) {
          return new Response(null, {
            status: 302,
            headers: { Location: presignedUrl },
          });
        }
        const bytes = await storage.getBytes(content);
        const isAudio = content.endsWith(".mp3");
        return new Response(bytes as unknown as BodyInit, {
          headers: {
            "Content-Type": isAudio ? "audio/mpeg" : "video/mp4",
            "Content-Disposition": `attachment; filename="${isAudio ? "media.mp3" : "media.mp4"}"`,
          },
        });
      }

      const fileExtractor = FILE_EXTRACTORS[extractor];
      if (fileExtractor) {
        if (!storage.validateRef(content)) {
          return new Response(JSON.stringify({ error: "forbidden" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (!(await storage.fileExists(content))) {
          return new Response(JSON.stringify({ error: "file not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }
        const presignedUrl = storage.presignedDownloadUrl(content);
        if (presignedUrl) {
          return new Response(null, {
            status: 302,
            headers: { Location: presignedUrl },
          });
        }
        const bytes = await storage.getBytes(content);
        return new Response(bytes as unknown as BodyInit, {
          headers: {
            "Content-Type": fileExtractor.contentType,
            "Content-Disposition": `attachment; filename="${fileExtractor.filename}"`,
          },
        });
      }

      // Default: return raw content (e.g. readability JSON, html)
      return new Response(content, {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="${extractor}.json"`,
        },
      });
    },
    {
      params: t.Object({ id: t.String(), extractor: t.String() }),
    },
  );
