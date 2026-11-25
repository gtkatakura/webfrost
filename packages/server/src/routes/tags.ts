import {
  InvalidTagNameError,
  type Tag,
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
import { apiError, apiErrorHandler } from "../errors";
import { MAX_TAG_COLOR_LENGTH, MAX_TAG_NAME_LENGTH } from "../limits";
import { isoTimestampRequired, paginate } from "../serialize";
import { hiddenFromGuest } from "./snapshots";

/** A tag as the API returns it. */
export function serializeTag(tag: Tag) {
  return {
    id: tag.id,
    name: tag.name,
    slug: tag.slug,
    color: tag.color,
    createdAt: isoTimestampRequired(tag.created_at),
  };
}

const pageQuery = t.Object({ page: t.Optional(t.String()), limit: t.Optional(t.String()) });

// GET/POST/DELETE /api/v1/tags
export const tagsRouter = new Elysia({ prefix: "/tags" })
  .onError(apiErrorHandler)
  .get(
    "/",
    async ({ query }) => {
      const db = await getDb();
      try {
        return paginate((await listTags(db)).map(serializeTag), query);
      } finally {
        await db.close();
      }
    },
    { query: pageQuery },
  )
  .post(
    "/",
    async ({ body, set }) => {
      const { name, color } = body;
      const db = await getDb();
      try {
        const tag = await createTag(db, name, color ?? undefined);
        set.status = 201;
        return serializeTag(tag);
      } catch (err) {
        if (err instanceof InvalidTagNameError) {
          return apiError(set, 400, "VALIDATION", err.message);
        }
        const msg = err instanceof Error ? err.message : "unknown error";
        if (msg.includes("UNIQUE") || msg.includes("unique")) {
          return apiError(set, 409, "CONFLICT", "tag already exists");
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
        return apiError(set, 404, "NOT_FOUND", "not found");
      }
      const db = await getDb();
      try {
        const removed = await deleteTag(db, id);
        if (!removed) {
          return apiError(set, 404, "NOT_FOUND", "not found");
        }
        set.status = 204;
        return null;
      } finally {
        await db.close();
      }
    },
    { params: t.Object({ id: t.String() }) },
  );

// GET/POST/DELETE /api/v1/snapshots/:id/tags
export const snapshotTagsRouter = new Elysia({ prefix: "/snapshots" })
  .onError(apiErrorHandler)
  .get(
    "/:id/tags",
    async ({ params, query, set, request }) => {
      const snapshotId = Number(params.id);
      if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
        return apiError(set, 404, "NOT_FOUND", "not found");
      }
      const db = await getDb();
      try {
        const snapshot = await getSnapshot(db, snapshotId);
        // In the trash it is hidden from anonymous visitors, like the snapshot itself.
        if (!snapshot || hiddenFromGuest(request, snapshot.trashed_at)) {
          return apiError(set, 404, "NOT_FOUND", "not found");
        }
        return paginate((await listSnapshotTags(db, snapshotId)).map(serializeTag), query);
      } finally {
        await db.close();
      }
    },
    { params: t.Object({ id: t.String() }), query: pageQuery },
  )
  .post(
    "/:id/tags",
    async ({ params, body, set }) => {
      const snapshotId = Number(params.id);
      if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
        return apiError(set, 404, "NOT_FOUND", "not found");
      }
      const db = await getDb();
      try {
        const snapshot = await getSnapshot(db, snapshotId);
        if (!snapshot) {
          return apiError(set, 404, "NOT_FOUND", "not found");
        }
        const tag = await getTag(db, body.tagId);
        if (!tag) {
          return apiError(set, 404, "NOT_FOUND", "tag not found");
        }
        await addTagToSnapshot(db, snapshotId, body.tagId);
        set.status = 201;
        return serializeTag(tag);
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
        return apiError(set, 404, "NOT_FOUND", "not found");
      }
      if (!Number.isInteger(tagId) || tagId <= 0) {
        return apiError(set, 404, "NOT_FOUND", "not found");
      }
      const db = await getDb();
      try {
        const snapshot = await getSnapshot(db, snapshotId);
        if (!snapshot) {
          return apiError(set, 404, "NOT_FOUND", "not found");
        }
        const removed = await removeTagFromSnapshot(db, snapshotId, tagId);
        if (!removed) {
          return apiError(set, 404, "NOT_FOUND", "not found");
        }
        set.status = 204;
        return null;
      } finally {
        await db.close();
      }
    },
    { params: t.Object({ id: t.String(), tagId: t.String() }) },
  );
