import {
  addTagToSnapshot,
  createTag,
  deleteTag,
  getSnapshot,
  getTag,
  listSnapshotTags,
  listTags,
  removeTagFromSnapshot,
} from "@webfrost/core";
import { Elysia, t } from "elysia";
import { getDb } from "../context";
import { apiErrorHandler } from "../errors";
import { MAX_TAG_COLOR_LENGTH, MAX_TAG_NAME_LENGTH } from "../limits";

// GET/POST/DELETE /api/tags
export const tagsRouter = new Elysia({ prefix: "/tags" })
  .onError(apiErrorHandler)
  .get("/", async () => {
    const db = await getDb();
    try {
      return (await listTags(db)).map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        color: t.color,
        createdAt: t.created_at,
      }));
    } finally {
      await db.close();
    }
  })
  .post(
    "/",
    async ({ body, set }) => {
      const { name, color } = body;
      const db = await getDb();
      try {
        const tag = await createTag(db, name, color ?? undefined);
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
        await db.close();
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: MAX_TAG_NAME_LENGTH }),
        color: t.Optional(t.String({ maxLength: MAX_TAG_COLOR_LENGTH })),
      }),
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
      const db = await getDb();
      try {
        const removed = await deleteTag(db, id);
        if (!removed) {
          set.status = 404;
          return { error: "not found" };
        }
        set.status = 204;
        return null;
      } finally {
        await db.close();
      }
    },
    { params: t.Object({ id: t.String() }) },
  );

// GET/POST/DELETE /api/snapshots/:id/tags
export const snapshotTagsRouter = new Elysia({ prefix: "/snapshots" })
  .onError(apiErrorHandler)
  .get(
    "/:id/tags",
    async ({ params, set }) => {
      const snapshotId = Number(params.id);
      if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
        set.status = 404;
        return { error: "not found" };
      }
      const db = await getDb();
      try {
        const snapshot = await getSnapshot(db, snapshotId);
        if (!snapshot) {
          set.status = 404;
          return { error: "not found" };
        }
        return (await listSnapshotTags(db, snapshotId)).map((t) => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
          color: t.color,
          createdAt: t.created_at,
        }));
      } finally {
        await db.close();
      }
    },
    { params: t.Object({ id: t.String() }) },
  )
  .post(
    "/:id/tags",
    async ({ params, body, set }) => {
      const snapshotId = Number(params.id);
      if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
        set.status = 404;
        return { error: "not found" };
      }
      const db = await getDb();
      try {
        const snapshot = await getSnapshot(db, snapshotId);
        if (!snapshot) {
          set.status = 404;
          return { error: "not found" };
        }
        const tag = await getTag(db, body.tagId);
        if (!tag) {
          set.status = 404;
          return { error: "tag not found" };
        }
        await addTagToSnapshot(db, snapshotId, body.tagId);
        set.status = 201;
        return {
          id: tag.id,
          name: tag.name,
          slug: tag.slug,
          color: tag.color,
          createdAt: tag.created_at,
        };
      } finally {
        await db.close();
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ tagId: t.Number() }),
    },
  )
  .delete(
    "/:id/tags/:tagId",
    async ({ params, set }) => {
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
      const db = await getDb();
      try {
        const snapshot = await getSnapshot(db, snapshotId);
        if (!snapshot) {
          set.status = 404;
          return { error: "not found" };
        }
        const removed = await removeTagFromSnapshot(db, snapshotId, tagId);
        if (!removed) {
          set.status = 404;
          return { error: "not found" };
        }
        set.status = 204;
        return null;
      } finally {
        await db.close();
      }
    },
    { params: t.Object({ id: t.String(), tagId: t.String() }) },
  );
