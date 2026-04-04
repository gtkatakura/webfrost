import type Database from "bun:sqlite";
import { nextCronDate } from "./cron";

export interface Schedule {
  id: number;
  url: string;
  cron: string;
  /** "url" = archive this URL on each run; "rss_feed" = fetch feed and archive new article URLs. */
  kind: string;
  created_at: string;
  last_run_at: string | null;
  next_run_at: string;
  /** 0 = active, 1 = paused */
  paused: number;
  last_status: string | null;
  consecutive_failures: number;
}

const SCHEDULE_COLS =
  "id, url, cron, COALESCE(kind, 'url') AS kind, created_at, last_run_at, next_run_at, " +
  "COALESCE(paused, 0) AS paused, last_status, COALESCE(consecutive_failures, 0) AS consecutive_failures";

/** Add a new recurring schedule. Returns the new schedule id. */
export function addSchedule(
  db: Database,
  url: string,
  cron: string,
  kind: "url" | "rss_feed" = "url",
): number {
  // Validate cron and compute first next_run_at
  const nextRun = nextCronDate(cron, new Date());
  const nextRunIso = nextRun.toISOString().replace("T", " ").slice(0, 19);

  const row = db
    .query<{ id: number }, [string, string, string, string]>(
      "INSERT INTO schedules (url, cron, next_run_at, kind) VALUES (?, ?, ?, ?) RETURNING id",
    )
    .get(url, cron, nextRunIso, kind);

  if (!row) throw new Error("Failed to insert schedule");
  return row.id;
}

/** Add a new RSS feed schedule. Shorthand for addSchedule with kind='rss_feed'. */
export function addRssFeedSchedule(db: Database, feedUrl: string, cron: string): number {
  return addSchedule(db, feedUrl, cron, "rss_feed");
}

/** Return a single schedule by id, or null if not found. */
export function getSchedule(db: Database, id: number): Schedule | null {
  return (
    db.query<Schedule, [number]>(`SELECT ${SCHEDULE_COLS} FROM schedules WHERE id = ?`).get(id) ??
    null
  );
}

/** List all schedules ordered by creation time. */
export function listSchedules(db: Database): Schedule[] {
  return db.query<Schedule, []>(`SELECT ${SCHEDULE_COLS} FROM schedules ORDER BY id`).all();
}

/** Remove a schedule by id. Returns true if a row was deleted. */
export function removeSchedule(db: Database, id: number): boolean {
  const result = db.query<null, [number]>("DELETE FROM schedules WHERE id = ?").run(id);
  return result.changes > 0;
}

/** Return all schedules whose next_run_at is at or before now and are not paused. */
export function getDueSchedules(db: Database): Schedule[] {
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  return db
    .query<Schedule, [string]>(
      `SELECT ${SCHEDULE_COLS} FROM schedules WHERE next_run_at <= ? AND COALESCE(paused, 0) = 0`,
    )
    .all(now);
}

/** Set the paused state of a schedule. Returns true if the schedule was found. */
export function pauseSchedule(db: Database, id: number, paused: boolean): boolean {
  const result = db
    .query<null, [number, number]>("UPDATE schedules SET paused = ? WHERE id = ?")
    .run(paused ? 1 : 0, id);
  return result.changes > 0;
}

/** Record the outcome of a schedule run. Resets consecutive_failures on success, increments on failure. */
export function updateScheduleStatus(db: Database, id: number, status: "success" | "failed"): void {
  if (status === "success") {
    db.query<null, [number]>(
      "UPDATE schedules SET last_status = 'success', consecutive_failures = 0 WHERE id = ?",
    ).run(id);
  } else {
    db.query<null, [number]>(
      "UPDATE schedules SET last_status = 'failed', consecutive_failures = COALESCE(consecutive_failures, 0) + 1 WHERE id = ?",
    ).run(id);
  }
}

/** Record that a schedule just ran and advance next_run_at. */
export function markScheduleRun(db: Database, id: number, cron: string): void {
  const now = new Date();
  const nowIso = now.toISOString().replace("T", " ").slice(0, 19);

  // Advance from max(now, current_next_run_at) so that:
  // - if the schedule ran on time (next_run_at ≥ now), we skip the current
  //   cron window rather than landing on the same slot again;
  // - if the schedule was overdue (next_run_at < now), we advance from now
  //   so the new next_run_at is a near-future time.
  const row = db
    .query<{ next_run_at: string }, [number]>("SELECT next_run_at FROM schedules WHERE id = ?")
    .get(id);
  const prevNext = row ? new Date(`${row.next_run_at.replace(" ", "T")}Z`) : now;
  const advanceFrom = prevNext > now ? prevNext : now;
  const nextRun = nextCronDate(cron, advanceFrom);
  const nextRunIso = nextRun.toISOString().replace("T", " ").slice(0, 19);

  db.query<null, [string, string, number]>(
    "UPDATE schedules SET last_run_at = ?, next_run_at = ? WHERE id = ?",
  ).run(nowIso, nextRunIso, id);
}
