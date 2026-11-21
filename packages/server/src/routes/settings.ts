import { createApiKey, listApiKeys, revokeApiKey } from "@webfrost/core";
import { Elysia, t } from "elysia";
import { SERVER_VERSION, getDb, getWebfrostDir } from "../context";
import { apiErrorHandler } from "../errors";
import { MAX_API_KEY_NAME_LENGTH } from "../limits";

export const settingsRouter = new Elysia({ prefix: "/settings" })
  .onError(apiErrorHandler)
  .get("/info", () => {
    const webfrostDir = getWebfrostDir();
    const db = getDb();
    try {
      const row = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM snapshots").get();
      return {
        version: SERVER_VERSION,
        storagePath: webfrostDir,
        snapshotCount: row?.count ?? 0,
      };
    } finally {
      db.close();
    }
  })
  .get("/keys", () => {
    const db = getDb();
    try {
      return listApiKeys(db);
    } finally {
      db.close();
    }
  })
  .post(
    "/keys",
    ({ body, set }) => {
      const db = getDb();
      try {
        const { id, rawKey } = createApiKey(db, body.name);
        const keys = listApiKeys(db);
        const key = keys.find((k) => k.id === id);
        if (!key) {
          set.status = 500;
          return { error: "Failed to create key" };
        }
        set.status = 201;
        return { ...key, rawKey };
      } finally {
        db.close();
      }
    },
    { body: t.Object({ name: t.String({ minLength: 1, maxLength: MAX_API_KEY_NAME_LENGTH }) }) },
  )
  .delete("/keys/:id", ({ params, set }) => {
    const db = getDb();
    try {
      const revoked = revokeApiKey(db, params.id);
      if (!revoked) {
        set.status = 404;
        return { error: "Key not found" };
      }
      set.status = 204;
      return;
    } finally {
      db.close();
    }
  });
