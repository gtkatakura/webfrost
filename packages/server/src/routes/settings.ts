import {
  type ApiKey,
  SettingRangeError,
  TRASH_RETENTION_DAYS,
  createApiKey,
  getTrashRetentionDays,
  listApiKeys,
  parseDbTimestamp,
  revokeApiKey,
  setTrashRetentionDays,
  sql,
} from "@webfrost/core";
import { Elysia, t } from "elysia";
import { SERVER_VERSION, getDb, getWebfrostDir } from "../context";
import { apiError, apiErrorHandler } from "../errors";
import { MAX_API_KEY_NAME_LENGTH } from "../limits";
import { isoTimestamp, isoTimestampRequired, paginate, parseIsoTimestamp } from "../serialize";
import { apiKeyOf } from "./auth";

/** An API key as the API returns it: never its hash, and only active keys are listed. */
function serializeApiKey(key: ApiKey) {
  return {
    id: key.id,
    name: key.name,
    expiresAt: isoTimestamp(key.expiresAt),
    lastUsedAt: isoTimestamp(key.lastUsedAt),
    createdAt: isoTimestampRequired(key.createdAt),
  };
}

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
  .get("/general", async () => {
    const db = await getDb();
    try {
      return {
        trashRetentionDays: await getTrashRetentionDays(db),
        trashRetentionLimits: { min: TRASH_RETENTION_DAYS.min, max: TRASH_RETENTION_DAYS.max },
      };
    } finally {
      await db.close();
    }
  })
  .patch(
    "/general",
    async ({ body, set }) => {
      const db = await getDb();
      try {
        if (body.trashRetentionDays !== undefined) {
          try {
            await setTrashRetentionDays(db, body.trashRetentionDays);
          } catch (err) {
            if (err instanceof SettingRangeError)
              return apiError(set, 400, "VALIDATION", err.message);
            throw err;
          }
        }
        return {
          trashRetentionDays: await getTrashRetentionDays(db),
          trashRetentionLimits: { min: TRASH_RETENTION_DAYS.min, max: TRASH_RETENTION_DAYS.max },
        };
      } finally {
        await db.close();
      }
    },
    { body: t.Object({ trashRetentionDays: t.Optional(t.Integer()) }) },
  )
  .get(
    "/keys",
    async ({ query }) => {
      const db = await getDb();
      try {
        return paginate((await listApiKeys(db)).map(serializeApiKey), query);
      } finally {
        await db.close();
      }
    },
    { query: t.Object({ page: t.Optional(t.String()), limit: t.Optional(t.String()) }) },
  )
  .post(
    "/keys",
    async ({ body, request, set }) => {
      // An optional ISO 8601 expiry ("2027-01-01T00:00:00Z"); without one the key never expires.
      let expiresAt: string | undefined;
      if (body.expiresAt !== undefined && body.expiresAt !== null) {
        const parsed = parseIsoTimestamp(body.expiresAt);
        if (parsed === null) {
          return apiError(set, 400, "VALIDATION", "expiresAt must be an ISO 8601 timestamp");
        }
        if (Date.parse(`${parsed.replace(" ", "T")}Z`) <= Date.now()) {
          return apiError(set, 400, "VALIDATION", "expiresAt must be in the future");
        }
        expiresAt = parsed;
      }
      // A key may not mint a key that outlives it, or a leaked short-lived key would buy
      // permanent access. Sessions and keys that never expire are not limited.
      const caller = apiKeyOf(request);
      if (caller?.expiresAt != null) {
        const callerExpiry = parseDbTimestamp(caller.expiresAt);
        if (expiresAt === undefined || parseDbTimestamp(expiresAt) > callerExpiry) {
          return apiError(
            set,
            403,
            "FORBIDDEN",
            "an expiring API key can only create keys that expire no later than itself",
          );
        }
      }
      const db = await getDb();
      try {
        const { id, rawKey } = await createApiKey(db, body.name, expiresAt);
        const keys = await listApiKeys(db);
        const key = keys.find((k) => k.id === id);
        if (!key) throw new Error("API key not found after insert");
        set.status = 201;
        return { ...serializeApiKey(key), rawKey };
      } finally {
        await db.close();
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: MAX_API_KEY_NAME_LENGTH }),
        expiresAt: t.Optional(t.Nullable(t.String({ maxLength: 64 }))),
      }),
    },
  )
  .delete("/keys/:id", async ({ params, set }) => {
    const db = await getDb();
    try {
      const revoked = await revokeApiKey(db, params.id);
      if (!revoked) return apiError(set, 404, "NOT_FOUND", "Key not found");
      set.status = 204;
      return;
    } finally {
      await db.close();
    }
  });
