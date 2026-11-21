import { createApiKey, listApiKeys, revokeApiKey, sql } from "@webfrost/core";
import { Elysia, t } from "elysia";
import { SERVER_VERSION, getDb, getWebfrostDir } from "../context";
import { apiErrorHandler } from "../errors";
import { MAX_API_KEY_NAME_LENGTH } from "../limits";

export const settingsRouter = new Elysia({ prefix: "/settings" })
  .onError(apiErrorHandler)
  .get("/info", async () => {
    const webfrostDir = getWebfrostDir();
    const db = await getDb();
    try {
      const row = await db.get<{ count: number }>(sql`SELECT COUNT(*) as count FROM snapshots`);
      return {
        version: SERVER_VERSION,
        storagePath: webfrostDir,
        snapshotCount: Number(row?.count ?? 0),
      };
    } finally {
      await db.close();
    }
  })
  .get("/keys", async () => {
    const db = await getDb();
    try {
      return await listApiKeys(db);
    } finally {
      await db.close();
    }
  })
  .post(
    "/keys",
    async ({ body, set }) => {
      const db = await getDb();
      try {
        const { id, rawKey } = await createApiKey(db, body.name);
        const keys = await listApiKeys(db);
        const key = keys.find((k) => k.id === id);
        if (!key) {
          set.status = 500;
          return { error: "Failed to create key" };
        }
        set.status = 201;
        return { ...key, rawKey };
      } finally {
        await db.close();
      }
    },
    { body: t.Object({ name: t.String({ minLength: 1, maxLength: MAX_API_KEY_NAME_LENGTH }) }) },
  )
  .delete("/keys/:id", async ({ params, set }) => {
    const db = await getDb();
    try {
      const revoked = await revokeApiKey(db, params.id);
      if (!revoked) {
        set.status = 404;
        return { error: "Key not found" };
      }
      set.status = 204;
      return;
    } finally {
      await db.close();
    }
  });
