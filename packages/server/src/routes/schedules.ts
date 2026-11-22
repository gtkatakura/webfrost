import {
  type Schedule,
  addSchedule,
  getSchedule,
  listSchedules,
  pauseSchedule,
  removeSchedule,
} from "@webfrost/core";
import { Elysia, t } from "elysia";
import { getDb } from "../context";
import { apiError, apiErrorHandler } from "../errors";
import { MAX_CRON_LENGTH, MAX_URL_LENGTH } from "../limits";
import { isoTimestamp, isoTimestampRequired, paginate } from "../serialize";

function mapSchedule(s: Schedule) {
  return {
    id: s.id,
    url: s.url,
    cron: s.cron,
    createdAt: isoTimestampRequired(s.created_at),
    lastRunAt: isoTimestamp(s.last_run_at),
    nextRunAt: isoTimestamp(s.next_run_at),
    paused: s.paused === 1,
    lastStatus: s.last_status,
    consecutiveFailures: s.consecutive_failures,
  };
}

export const schedulesRouter = new Elysia({ prefix: "/schedules" })
  .onError(apiErrorHandler)
  .post(
    "/",
    async ({ body, set }) => {
      const { url, cron } = body;

      // Validate HTTP/HTTPS URL
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return apiError(set, 400, "VALIDATION", "invalid url");
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return apiError(set, 400, "VALIDATION", "invalid url");
      }

      const db = await getDb();
      try {
        const id = await addSchedule(db, url, cron);
        const schedule = await getSchedule(db, id);
        if (!schedule) throw new Error("Schedule not found after insert");
        set.status = 201;
        return mapSchedule(schedule);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        if (msg.includes("Cron expression") || msg.includes("cron")) {
          return apiError(set, 400, "VALIDATION", msg);
        }
        throw err;
      } finally {
        await db.close();
      }
    },
    {
      body: t.Object({
        url: t.String({ maxLength: MAX_URL_LENGTH }),
        cron: t.String({ maxLength: MAX_CRON_LENGTH }),
      }),
    },
  )
  .get(
    "/",
    async ({ query }) => {
      const db = await getDb();
      try {
        return paginate((await listSchedules(db)).map(mapSchedule), query);
      } finally {
        await db.close();
      }
    },
    { query: t.Object({ page: t.Optional(t.String()), limit: t.Optional(t.String()) }) },
  )
  .get(
    "/:id",
    async ({ params, set }) => {
      const id = Number(params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return apiError(set, 404, "NOT_FOUND", "not found");
      }

      const db = await getDb();
      try {
        const schedule = await getSchedule(db, id);
        if (!schedule) {
          return apiError(set, 404, "NOT_FOUND", "not found");
        }
        return mapSchedule(schedule);
      } finally {
        await db.close();
      }
    },
    { params: t.Object({ id: t.String() }) },
  )
  .patch(
    "/:id",
    async ({ params, body, set }) => {
      const id = Number(params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return apiError(set, 404, "NOT_FOUND", "not found");
      }

      const db = await getDb();
      try {
        const found = await pauseSchedule(db, id, body.paused);
        if (!found) {
          return apiError(set, 404, "NOT_FOUND", "not found");
        }
        const schedule = await getSchedule(db, id);
        if (!schedule) return apiError(set, 404, "NOT_FOUND", "not found");
        return mapSchedule(schedule);
      } finally {
        await db.close();
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ paused: t.Boolean() }),
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
        const removed = await removeSchedule(db, id);
        if (!removed) {
          return apiError(set, 404, "NOT_FOUND", "not found");
        }
        set.status = 204;
        return null;
      } finally {
        await db.close();
      }
    },
    {
      params: t.Object({ id: t.String() }),
    },
  );
