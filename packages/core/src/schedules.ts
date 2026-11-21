import { sql } from "kysely";
import { nextCronDate } from "./cron";
import type { Db } from "./db";

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

const SCHEDULE_COLS = sql`id, url, cron, COALESCE(kind, 'url') AS kind, created_at, last_run_at, next_run_at,
  COALESCE(paused, 0) AS paused, last_status, COALESCE(consecutive_failures, 0) AS consecutive_failures`;

/** UTC "YYYY-MM-DD HH:MM:SS", the timestamp format stored in every dialect. */
export function dbTimestamp(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

/** Add a new recurring schedule. Returns the new schedule id. */
export async function addSchedule(
  db: Db,
  url: string,
  cron: string,
  kind: "url" | "rss_feed" = "url",
): Promise<number> {
  // Validate cron and compute first next_run_at
  const nextRun = dbTimestamp(nextCronDate(cron, new Date()));
  return db.insert(
    sql`INSERT INTO schedules (url, cron, next_run_at, kind, created_at) VALUES (${url}, ${cron}, ${nextRun}, ${kind}, ${db.now()})`,
  );
}

/** Add a new RSS feed schedule. Shorthand for addSchedule with kind='rss_feed'. */
export function addRssFeedSchedule(db: Db, feedUrl: string, cron: string): Promise<number> {
  return addSchedule(db, feedUrl, cron, "rss_feed");
}

/** Return a single schedule by id, or null if not found. */
export async function getSchedule(db: Db, id: number): Promise<Schedule | null> {
  return db.get<Schedule>(sql`SELECT ${SCHEDULE_COLS} FROM schedules WHERE id = ${id}`);
}

/** List all schedules ordered by creation time. */
export async function listSchedules(db: Db): Promise<Schedule[]> {
  return db.all<Schedule>(sql`SELECT ${SCHEDULE_COLS} FROM schedules ORDER BY id`);
}

/** Remove a schedule by id. Returns true if a row was deleted. */
export async function removeSchedule(db: Db, id: number): Promise<boolean> {
  return (await db.run(sql`DELETE FROM schedules WHERE id = ${id}`)) > 0;
}

/** Return all schedules whose next_run_at is at or before now and are not paused. */
export async function getDueSchedules(db: Db): Promise<Schedule[]> {
  const now = dbTimestamp(new Date());
  return db.all<Schedule>(
    sql`SELECT ${SCHEDULE_COLS} FROM schedules WHERE next_run_at <= ${now} AND COALESCE(paused, 0) = 0 ORDER BY id`,
  );
}

/** Set the paused state of a schedule. Returns true if the schedule was found. */
export async function pauseSchedule(db: Db, id: number, paused: boolean): Promise<boolean> {
  return (await db.run(sql`UPDATE schedules SET paused = ${paused ? 1 : 0} WHERE id = ${id}`)) > 0;
}

/** Record the outcome of a schedule run. Resets consecutive_failures on success, increments on failure. */
export async function updateScheduleStatus(
  db: Db,
  id: number,
  status: "success" | "failed",
): Promise<void> {
  if (status === "success") {
    await db.run(
      sql`UPDATE schedules SET last_status = 'success', consecutive_failures = 0 WHERE id = ${id}`,
    );
  } else {
    await db.run(
      sql`UPDATE schedules SET last_status = 'failed', consecutive_failures = COALESCE(consecutive_failures, 0) + 1 WHERE id = ${id}`,
    );
  }
}

/** Record that a schedule just ran and advance next_run_at. */
export async function markScheduleRun(db: Db, id: number, cron: string): Promise<void> {
  const now = new Date();

  // Advance from max(now, current_next_run_at) so that:
  // - if the schedule ran on time (next_run_at ≥ now), we skip the current
  //   cron window rather than landing on the same slot again;
  // - if the schedule was overdue (next_run_at < now), we advance from now
  //   so the new next_run_at is a near-future time.
  const row = await db.get<{ next_run_at: string }>(
    sql`SELECT next_run_at FROM schedules WHERE id = ${id}`,
  );
  const prevNext = row ? new Date(`${row.next_run_at.replace(" ", "T")}Z`) : now;
  const advanceFrom = prevNext > now ? prevNext : now;
  const nextRun = dbTimestamp(nextCronDate(cron, advanceFrom));

  await db.run(
    sql`UPDATE schedules SET last_run_at = ${dbTimestamp(now)}, next_run_at = ${nextRun} WHERE id = ${id}`,
  );
}
