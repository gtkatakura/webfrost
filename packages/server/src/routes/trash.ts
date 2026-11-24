import {
  deleteSnapshotsForever,
  getTrashRetentionDays,
  listTrash,
  parseDbTimestamp,
  restoreSnapshots,
  trashedIds,
} from "@webfrost/core";
import { Elysia, t } from "elysia";
import { getDb, getStorage } from "../context";
import { apiErrorHandler } from "../errors";
import { isoTimestampRequired } from "../serialize";
import { isGuestRequest } from "./auth";
import { serializeFailure } from "./snapshots";

/** Explicit `ids`, or `all` (everything in the trash) less `excludeIds`. */
const idsBody = t.Object({
  ids: t.Optional(t.Array(t.Integer({ minimum: 1 }), { maxItems: 5000 })),
  all: t.Optional(t.Boolean()),
  excludeIds: t.Optional(t.Array(t.Integer({ minimum: 1 }), { maxItems: 5000 })),
});

async function selectedIds(
  db: Awaited<ReturnType<typeof getDb>>,
  body: {
    ids?: number[] | undefined;
    all?: boolean | undefined;
    excludeIds?: number[] | undefined;
  },
): Promise<number[]> {
  if (body.all) return trashedIds(db, body.excludeIds ?? []);
  const skip = new Set(body.excludeIds ?? []);
  return (body.ids ?? []).filter((id) => !skip.has(id));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The trash: snapshots moved there, restorable until the retention passes, then deleted for good. */
export const trashRouter = new Elysia({ prefix: "/trash" })
  .onError(apiErrorHandler)
  .get(
    "/",
    async ({ query, request }) => {
      const guest = isGuestRequest(request);
      const db = await getDb();
      try {
        const days = await getTrashRetentionDays(db);
        const result = await listTrash(db, Number(query.page ?? 1), Number(query.limit ?? 50));
        return {
          ...result,
          retentionDays: days,
          items: result.items.map((s) => {
            const trashedMs = parseDbTimestamp(s.trashed_at);
            return {
              id: s.id,
              url: s.url,
              status: s.status,
              failure: serializeFailure(s.failure_category, s.failure_detail, guest),
              createdAt: isoTimestampRequired(s.created_at),
              trashedAt: isoTimestampRequired(s.trashed_at),
              // When the hourly sweep deletes it for good (at the latest an hour after this).
              deleteAfter: Number.isFinite(trashedMs)
                ? new Date(trashedMs + days * DAY_MS).toISOString().replace(/\.\d{3}Z$/, "Z")
                : null,
            };
          }),
        };
      } finally {
        await db.close();
      }
    },
    {
      query: t.Object({
        page: t.Optional(t.String({ pattern: "^[0-9]{1,9}$" })),
        limit: t.Optional(t.String({ pattern: "^[0-9]{1,3}$" })),
      }),
    },
  )
  .post(
    "/restore",
    async ({ body }) => {
      const db = await getDb();
      try {
        return { restored: await restoreSnapshots(db, await selectedIds(db, body)) };
      } finally {
        await db.close();
      }
    },
    { body: idsBody },
  )
  .post(
    "/delete",
    async ({ body }) => {
      const db = await getDb();
      try {
        return await deleteSnapshotsForever(db, await selectedIds(db, body), getStorage(), {
          onlyTrashed: true,
        });
      } finally {
        await db.close();
      }
    },
    { body: idsBody },
  )
  .post("/empty", async () => {
    const db = await getDb();
    try {
      return await deleteSnapshotsForever(db, await trashedIds(db), getStorage(), {
        onlyTrashed: true,
      });
    } finally {
      await db.close();
    }
  });
