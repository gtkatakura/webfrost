import {
  addSchedule,
  getSchedule,
  listSchedules,
  pauseSchedule,
  removeSchedule,
} from "@webfrost/core";
import { Elysia, t } from "elysia";
import { getDb } from "../context";
import { apiErrorHandler } from "../errors";
import { MAX_CRON_LENGTH, MAX_URL_LENGTH } from "../limits";

function mapSchedule(s: ReturnType<typeof getSchedule>) {
  if (!s) return null;
  return {
    id: s.id,
    url: s.url,
    cron: s.cron,
    createdAt: s.created_at,
    lastRunAt: s.last_run_at,
    nextRunAt: s.next_run_at,
    paused: s.paused === 1,
    lastStatus: s.last_status,
    consecutiveFailures: s.consecutive_failures,
  };
}

export const schedulesRouter = new Elysia({ prefix: "/schedules" })
  .onError(apiErrorHandler)
  .post(
    "/",
    ({ body, set }) => {
      const { url, cron } = body;

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
      try {
        const id = addSchedule(db, url, cron);
        const schedule = getSchedule(db, id);
        if (!schedule) throw new Error("Schedule not found after insert");
        set.status = 201;
        return mapSchedule(schedule);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        if (msg.includes("Cron expression") || msg.includes("cron")) {
          set.status = 400;
          return { error: msg };
        }
        throw err;
      } finally {
        db.close();
      }
    },
    {
      body: t.Object({
        url: t.String({ maxLength: MAX_URL_LENGTH }),
        cron: t.String({ maxLength: MAX_CRON_LENGTH }),
      }),
    },
  )
  .get("/", () => {
    const db = getDb();
    try {
      return listSchedules(db).map(mapSchedule);
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
        const schedule = getSchedule(db, id);
        if (!schedule) {
          set.status = 404;
          return { error: "not found" };
        }
        return mapSchedule(schedule);
      } finally {
        db.close();
      }
    },
    { params: t.Object({ id: t.String() }) },
  )
  .patch(
    "/:id",
    ({ params, body, set }) => {
      const id = Number(params.id);
      if (!Number.isInteger(id) || id <= 0) {
        set.status = 404;
        return { error: "not found" };
      }

      const db = getDb();
      try {
        const found = pauseSchedule(db, id, body.paused);
        if (!found) {
          set.status = 404;
          return { error: "not found" };
        }
        const schedule = getSchedule(db, id);
        return mapSchedule(schedule);
      } finally {
        db.close();
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ paused: t.Boolean() }),
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
        const removed = removeSchedule(db, id);
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
    {
      params: t.Object({ id: t.String() }),
    },
  );
