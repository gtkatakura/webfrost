import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  createSnapshot,
  deleteSnapshot,
  getSnapshot,
  listSnapshotsWithExtractorsPaginated,
  openDb,
  runPipeline,
  searchSnapshots,
} from "@webfrost/core";
import { Elysia, t } from "elysia";

function getWebfrostDir(): string {
  return process.env.WEBFROST_DIR ?? join(homedir(), ".webfrost");
}

const ALLOWED_EXTRACTORS = new Set([
  "html",
  "warc",
  "pdf",
  "readability",
  "screenshot",
  "dom-snapshot",
  "singlefile",
]);

function getDb() {
  return openDb(getWebfrostDir());
}

export const snapshotsRouter = new Elysia({ prefix: "/snapshots" })
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
      runPipeline(pipelineDb, snapshotId, url, getWebfrostDir())
        .catch((err: unknown) => {
          console.error("[pipeline] error for snapshot", snapshotId, err);
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
        const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

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
    ({ params, set }) => {
      const id = Number(params.id);
      if (!Number.isInteger(id) || id <= 0) {
        set.status = 404;
        return { error: "not found" };
      }

      const db = getDb();
      try {
        const snapshot = getSnapshot(db, id);
        if (!snapshot) {
          set.status = 404;
          return { error: "not found" };
        }
        return {
          id: snapshot.id,
          url: snapshot.url,
          status: snapshot.status,
          createdAt: snapshot.created_at,
          archiveResults: snapshot.archiveResults,
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
      try {
        const deleted = await deleteSnapshot(db, id, getWebfrostDir());
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

      // WARC and PDF store a filesystem path — sandbox to the snapshots directory
      const snapshotsDir = resolve(getWebfrostDir(), "snapshots");

      if (extractor === "warc") {
        if (!resolve(content).startsWith(`${snapshotsDir}/`)) {
          return new Response(JSON.stringify({ error: "forbidden" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          });
        }
        const file = Bun.file(content);
        if (!(await file.exists())) {
          return new Response(JSON.stringify({ error: "file not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(await file.bytes(), {
          headers: {
            "Content-Type": "application/warc",
            "Content-Disposition": 'attachment; filename="archive.warc"',
          },
        });
      }

      if (extractor === "pdf") {
        if (!resolve(content).startsWith(`${snapshotsDir}/`)) {
          return new Response(JSON.stringify({ error: "forbidden" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          });
        }
        const file = Bun.file(content);
        if (!(await file.exists())) {
          return new Response(JSON.stringify({ error: "file not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(await file.bytes(), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": 'attachment; filename="page.pdf"',
          },
        });
      }

      // Default: return raw content (e.g. readability JSON)
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
