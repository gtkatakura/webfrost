import type Database from "bun:sqlite";
import { nextCronDate } from "./cron";
import { openDb } from "./db";
import type { JobRunner } from "./jobs";
import { type Logger, createSnapshot } from "./pipeline";
import { fetchRssFeedUrls, isUrlArchived } from "./rss";
import { type Schedule, getDueSchedules, updateScheduleStatus } from "./schedules";

/** How often the scheduler looks for due schedules. */
export const SCHEDULER_INTERVAL_MS = 30_000;

export interface SchedulerOptions {
  /** Archive directory. */
  dir: string;
  /** Runs the pipelines the schedules produce (shared with the rest of the process). */
  runner: JobRunner;
  logger?: Logger;
  /** Polling interval in ms (default 30 s). */
  intervalMs?: number;
}

export interface Scheduler {
  /** Run one polling pass now. Resolves when every schedule it claimed has finished. */
  tick(): Promise<number>;
  /** Stop polling. Pipelines already queued keep running on the runner. */
  stop(): void;
}

function sqliteTimestamp(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

/**
 * Atomically claim a due schedule by advancing its `next_run_at`.
 *
 * The UPDATE only matches while `next_run_at` still holds the value we read, so
 * when two workers (or two overlapping ticks) see the same due schedule exactly
 * one of them wins. Claiming up front — rather than after the pipeline finishes —
 * is also what stops a slow run from being started again on the next tick.
 */
export function claimSchedule(db: Database, schedule: Schedule, now = new Date()): boolean {
  const nextRun = sqliteTimestamp(nextCronDate(schedule.cron, now));
  const result = db
    .query<null, [string, string, number, string]>(
      "UPDATE schedules SET last_run_at = ?, next_run_at = ? WHERE id = ? AND next_run_at = ? AND COALESCE(paused, 0) = 0",
    )
    .run(sqliteTimestamp(now), nextRun, schedule.id, schedule.next_run_at);
  return result.changes > 0;
}

// Schedules this process is currently running, keyed by archive directory and id.
// A run that outlasts its cron period must not be started a second time on top of itself.
const activeRuns = new Set<string>();

function withDb<T>(dir: string, fn: (db: Database) => T): T {
  const db = openDb(dir);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

async function runUrlSchedule(schedule: Schedule, options: SchedulerOptions): Promise<void> {
  const { dir, runner, logger } = options;
  const startedAt = Date.now();
  const snapshotId = withDb(dir, (db) => createSnapshot(db, schedule.url));
  await runner.enqueue(snapshotId, schedule.url);
  const status = withDb(
    dir,
    (db) =>
      db
        .query<{ status: string }, [number]>("SELECT status FROM snapshots WHERE id = ?")
        .get(snapshotId)?.status,
  );
  withDb(dir, (db) =>
    updateScheduleStatus(db, schedule.id, status === "done" ? "success" : "failed"),
  );
  logger?.info(
    `Schedule ${schedule.id} done: snapshot ${snapshotId} status=${status ?? "unknown"} (${Date.now() - startedAt}ms)`,
  );
}

async function runRssSchedule(schedule: Schedule, options: SchedulerOptions): Promise<void> {
  const { dir, runner, logger } = options;
  const startedAt = Date.now();
  const feedUrls = await fetchRssFeedUrls(schedule.url);
  const queued = withDb(dir, (db) => {
    const jobs: { snapshotId: number; url: string }[] = [];
    for (const url of feedUrls) {
      if (isUrlArchived(db, url)) continue;
      jobs.push({ snapshotId: createSnapshot(db, url), url });
    }
    return jobs;
  });
  await Promise.all(queued.map(({ snapshotId, url }) => runner.enqueue(snapshotId, url)));
  // A feed run succeeds when the feed itself could be read; individual article
  // failures are visible on their own snapshots.
  withDb(dir, (db) => updateScheduleStatus(db, schedule.id, "success"));
  logger?.info(
    `RSS feed schedule ${schedule.id} done: ${feedUrls.length} items, ${queued.length} new (${Date.now() - startedAt}ms)`,
  );
}

/**
 * Run every schedule that is due right now. Resolves with the number of
 * schedules this call claimed, after their pipelines have finished.
 */
export async function runDueSchedules(options: SchedulerOptions): Promise<number> {
  const { dir, logger } = options;
  const claimed = withDb(dir, (db) =>
    getDueSchedules(db).filter((schedule) => {
      // Still running from an earlier slot: leave it due, it runs once the current one ends.
      if (activeRuns.has(`${dir}:${schedule.id}`)) return false;
      try {
        return claimSchedule(db, schedule);
      } catch (err) {
        // A cron expression that no longer parses must not take the other schedules down with it.
        logger?.error(
          `Schedule ${schedule.id} skipped: ${err instanceof Error ? err.message : String(err)}`,
        );
        return false;
      }
    }),
  );
  if (claimed.length === 0) {
    logger?.debug("No schedules due.");
    return 0;
  }

  logger?.info(`Running ${claimed.length} due schedule(s).`);
  await Promise.all(
    claimed.map(async (schedule) => {
      const runKey = `${dir}:${schedule.id}`;
      activeRuns.add(runKey);
      try {
        if (schedule.kind === "rss_feed") {
          await runRssSchedule(schedule, options);
        } else {
          await runUrlSchedule(schedule, options);
        }
      } catch (err) {
        logger?.error(
          `Schedule ${schedule.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        try {
          withDb(dir, (db) => updateScheduleStatus(db, schedule.id, "failed"));
        } catch {
          // Archive unavailable — the next tick will report it again.
        }
      } finally {
        activeRuns.delete(runKey);
      }
    }),
  );
  return claimed.length;
}

/**
 * Start polling for due schedules. Used by both `webfrost schedule worker` and
 * the HTTP server, so schedules created in the web UI run without a second process.
 */
export function startScheduler(options: SchedulerOptions): Scheduler {
  const { logger } = options;

  const tick = (): Promise<number> =>
    runDueSchedules(options).catch((err: unknown) => {
      logger?.error(`Scheduler tick failed: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    });

  // Ticks may overlap: a schedule is claimed before it runs, so an overlapping
  // tick simply finds nothing due.
  const timer = setInterval(tick, options.intervalMs ?? SCHEDULER_INTERVAL_MS);
  void tick();

  return {
    tick,
    stop: () => clearInterval(timer),
  };
}
