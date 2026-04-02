import { homedir } from "node:os";
import { join } from "node:path";
import { createSnapshot, getSnapshot, listSnapshots, openDb, runPipeline } from "@webfrost/core";
import { Elysia, t } from "elysia";

function getWebfrostDir(): string {
  return process.env.WEBFROST_DIR ?? join(homedir(), ".webfrost");
}

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
        // Fire and forget — do not await so the HTTP response returns immediately
        runPipeline(db, snapshotId, url, getWebfrostDir()).catch((err: unknown) => {
          console.error("[pipeline] error for snapshot", snapshotId, err);
        });
      } finally {
        db.close();
      }

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
  .get("/", () => {
    const db = getDb();
    try {
      return listSnapshots(db).map((s) => ({
        id: s.id,
        url: s.url,
        status: s.status,
        createdAt: s.created_at,
      }));
    } finally {
      db.close();
    }
  })
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
  );
