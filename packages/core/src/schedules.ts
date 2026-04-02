import type Database from "bun:sqlite";
import { nextCronDate } from "./cron";

export interface Schedule {
  id: number;
  url: string;
  cron: string;
  created_at: string;
  last_run_at: string | null;
  next_run_at: string;
}

/** Add a new recurring schedule. Returns the new schedule id. */
export function addSchedule(db: Database, url: string, cron: string): number {
  // Validate cron and compute first next_run_at
  const nextRun = nextCronDate(cron, new Date());
  const nextRunIso = nextRun.toISOString().replace("T", " ").slice(0, 19);

  const row = db
    .query<{ id: number }, [string, string, string]>(
      "INSERT INTO schedules (url, cron, next_run_at) VALUES (?, ?, ?) RETURNING id",
    )
    .get(url, cron, nextRunIso);

  if (!row) throw new Error("Failed to insert schedule");
  return row.id;
}

/** List all schedules ordered by creation time. */
export function listSchedules(db: Database): Schedule[] {
  return db
    .query<Schedule, []>(
      "SELECT id, url, cron, created_at, last_run_at, next_run_at FROM schedules ORDER BY id",
    )
    .all();
}

/** Remove a schedule by id. Returns true if a row was deleted. */
export function removeSchedule(db: Database, id: number): boolean {
  const result = db.query<null, [number]>("DELETE FROM schedules WHERE id = ?").run(id);
  return result.changes > 0;
}

/** Return all schedules whose next_run_at is at or before now. */
export function getDueSchedules(db: Database): Schedule[] {
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  return db
    .query<Schedule, [string]>(
      "SELECT id, url, cron, created_at, last_run_at, next_run_at FROM schedules WHERE next_run_at <= ?",
    )
    .all(now);
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
