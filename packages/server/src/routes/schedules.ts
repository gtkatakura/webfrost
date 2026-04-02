import { homedir } from "node:os";
import { join } from "node:path";
import { addSchedule, listSchedules, openDb, removeSchedule } from "@webfrost/core";
import { Elysia, t } from "elysia";

function getWebfrostDir(): string {
  return process.env.WEBFROST_DIR ?? join(homedir(), ".webfrost");
}

function getDb() {
  return openDb(getWebfrostDir());
}

export const schedulesRouter = new Elysia({ prefix: "/schedules" })
  .onError(({ code, set }) => {
    if (code === "VALIDATION") {
      set.status = 400;
      return { error: "invalid request" };
    }
    return undefined;
  })
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
        const schedule = listSchedules(db).find((s) => s.id === id);
        if (!schedule) throw new Error("Schedule not found after insert");
        set.status = 201;
        return {
          id: schedule.id,
          url: schedule.url,
          cron: schedule.cron,
          createdAt: schedule.created_at,
          lastRunAt: schedule.last_run_at,
          nextRunAt: schedule.next_run_at,
        };
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
      body: t.Object({ url: t.String(), cron: t.String() }),
    },
  )
  .get("/", () => {
    const db = getDb();
    try {
      return listSchedules(db).map((s) => ({
        id: s.id,
        url: s.url,
        cron: s.cron,
        createdAt: s.created_at,
        lastRunAt: s.last_run_at,
        nextRunAt: s.next_run_at,
      }));
    } finally {
      db.close();
    }
  })
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
