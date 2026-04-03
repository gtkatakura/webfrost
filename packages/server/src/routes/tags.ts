import { homedir } from "node:os";
import { join } from "node:path";
import {
  addTagToSnapshot,
  createTag,
  deleteTag,
  getSnapshot,
  getTag,
  listSnapshotTags,
  listTags,
  openDb,
  removeTagFromSnapshot,
} from "@webfrost/core";
import { Elysia, t } from "elysia";

function getWebfrostDir(): string {
  return process.env.WEBFROST_DIR ?? join(homedir(), ".webfrost");
}

function getDb() {
  return openDb(getWebfrostDir());
}

// GET/POST/DELETE /api/tags
export const tagsRouter = new Elysia({ prefix: "/tags" })
  .onError(({ code, set }) => {
    if (code === "VALIDATION") {
      set.status = 400;
      return { error: "invalid request" };
    }
    return undefined;
  })
  .get("/", () => {
    const db = getDb();
    try {
      return listTags(db).map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        color: t.color,
        createdAt: t.created_at,
      }));
    } finally {
      db.close();
    }
  })
  .post(
    "/",
    ({ body, set }) => {
      const { name, color } = body;
      const db = getDb();
      try {
        const tag = createTag(db, name, color ?? undefined);
        set.status = 201;
        return {
          id: tag.id,
          name: tag.name,
          slug: tag.slug,
          color: tag.color,
          createdAt: tag.created_at,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        if (msg.includes("UNIQUE") || msg.includes("unique")) {
          set.status = 409;
          return { error: "tag already exists" };
        }
        throw err;
      } finally {
        db.close();
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        color: t.Optional(t.String()),
      }),
    },
  )
  .delete(
    "/:id",
    ({ params, set }) => {
      const id = Number(params.id);
      if (!Number.isInteger(id) || id <= 0) {
        set.status = 404;
        return { error: "not found" };
      }
      const db = getDb();
      try {
        const removed = deleteTag(db, id);
        if (!removed) {
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
  );

// GET/POST/DELETE /api/snapshots/:id/tags
export const snapshotTagsRouter = new Elysia({ prefix: "/snapshots" })
  .onError(({ code, set }) => {
    if (code === "VALIDATION") {
      set.status = 400;
      return { error: "invalid request" };
    }
    return undefined;
  })
  .get(
    "/:id/tags",
    ({ params, set }) => {
      const snapshotId = Number(params.id);
      if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
        set.status = 404;
        return { error: "not found" };
      }
      const db = getDb();
      try {
        const snapshot = getSnapshot(db, snapshotId);
        if (!snapshot) {
          set.status = 404;
          return { error: "not found" };
        }
        return listSnapshotTags(db, snapshotId).map((t) => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
          color: t.color,
          createdAt: t.created_at,
        }));
      } finally {
        db.close();
      }
    },
    { params: t.Object({ id: t.String() }) },
  )
  .post(
    "/:id/tags",
    ({ params, body, set }) => {
      const snapshotId = Number(params.id);
      if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
        set.status = 404;
        return { error: "not found" };
      }
      const db = getDb();
      try {
        const snapshot = getSnapshot(db, snapshotId);
        if (!snapshot) {
          set.status = 404;
          return { error: "not found" };
        }
        const tag = getTag(db, body.tagId);
        if (!tag) {
          set.status = 404;
          return { error: "tag not found" };
        }
        addTagToSnapshot(db, snapshotId, body.tagId);
        set.status = 201;
        return {
          id: tag.id,
          name: tag.name,
          slug: tag.slug,
          color: tag.color,
          createdAt: tag.created_at,
        };
      } finally {
        db.close();
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ tagId: t.Number() }),
    },
  )
  .delete(
    "/:id/tags/:tagId",
    ({ params, set }) => {
      const snapshotId = Number(params.id);
      const tagId = Number(params.tagId);
      if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
        set.status = 404;
        return { error: "not found" };
      }
      if (!Number.isInteger(tagId) || tagId <= 0) {
        set.status = 404;
        return { error: "not found" };
      }
      const db = getDb();
      try {
        const snapshot = getSnapshot(db, snapshotId);
        if (!snapshot) {
          set.status = 404;
          return { error: "not found" };
        }
        const removed = removeTagFromSnapshot(db, snapshotId, tagId);
        if (!removed) {
          set.status = 404;
          return { error: "not found" };
        }
        set.status = 204;
        return null;
      } finally {
        db.close();
      }
    },
    { params: t.Object({ id: t.String(), tagId: t.String() }) },
  );
