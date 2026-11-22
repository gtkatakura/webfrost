import { sql } from "kysely";
import { nextCronDate } from "./cron";
import { type Db, databaseKeyFor, openDb } from "./db";
import type { JobRunner } from "./jobs";
import { type Logger, createSnapshotJob } from "./pipeline";
import { fetchRssFeedUrls, isUrlArchived } from "./rss";
import { type Schedule, dbTimestamp, getDueSchedules, updateScheduleStatus } from "./schedules";
import { withSpan } from "./telemetry";

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

/**
 * Atomically claim a due schedule by advancing its `next_run_at`.
 *
 * The UPDATE only matches while `next_run_at` still holds the value we read, so
 * when two workers (or two overlapping ticks) see the same due schedule exactly
 * one of them wins. Claiming up front — rather than after the pipeline finishes —
 * is also what stops a slow run from being started again on the next tick.
 *
 * This compare-and-set is atomic on every database without extra locking: on
 * PostgreSQL and MySQL a concurrent UPDATE of the same row waits for the first
 * one to commit and then re-evaluates the WHERE clause against the new
 * `next_run_at`, so it matches nothing.
 */
export async function claimSchedule(
  db: Db,
  schedule: Schedule,
  now = new Date(),
): Promise<boolean> {
  const nextRun = dbTimestamp(nextCronDate(schedule.cron, now));
  const changes = await db.run(
    sql`UPDATE schedules SET last_run_at = ${dbTimestamp(now)}, next_run_at = ${nextRun}
        WHERE id = ${schedule.id} AND next_run_at = ${schedule.next_run_at} AND COALESCE(paused, 0) = 0`,
  );
  return changes > 0;
}

// Schedules this process is currently running, keyed by database and id.
// A run that outlasts its cron period must not be started a second time on top of itself.
const activeRuns = new Set<string>();

async function withDb<T>(dir: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const db = await openDb(dir);
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

async function runUrlSchedule(schedule: Schedule, options: SchedulerOptions): Promise<void> {
  const { dir, runner, logger } = options;
  const startedAt = Date.now();
  const { snapshotId, lease } = await withDb(dir, (db) => createSnapshotJob(db, schedule.url));
  await runner.enqueue(snapshotId, schedule.url, lease);
  const status = await withDb(
    dir,
    async (db) =>
      (await db.get<{ status: string }>(sql`SELECT status FROM snapshots WHERE id = ${snapshotId}`))
        ?.status,
  );
  await withDb(dir, (db) =>
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
  const queued = await withDb(dir, async (db) => {
    const jobs: { snapshotId: number; url: string; lease: string }[] = [];
    for (const url of feedUrls) {
      if (await isUrlArchived(db, url)) continue;
      jobs.push({ ...(await createSnapshotJob(db, url)), url });
    }
    return jobs;
  });
  await Promise.all(
    queued.map(({ snapshotId, url, lease }) => runner.enqueue(snapshotId, url, lease)),
  );
  // A feed run succeeds when the feed itself could be read; individual article
  // failures are visible on their own snapshots.
  await withDb(dir, (db) => updateScheduleStatus(db, schedule.id, "success"));
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
  const dbKey = databaseKeyFor(dir);
  const claimed = await withDb(dir, async (db) => {
    const won: Schedule[] = [];
    for (const schedule of await getDueSchedules(db)) {
      // Still running from an earlier slot: leave it due, it runs once the current one ends.
      if (activeRuns.has(`${dbKey}:${schedule.id}`)) continue;
      try {
        if (await claimSchedule(db, schedule)) won.push(schedule);
      } catch (err) {
        // A cron expression that no longer parses must not take the other schedules down with it.
        logger?.error(
          `Schedule ${schedule.id} skipped: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return won;
  });
  if (claimed.length === 0) {
    logger?.debug("No schedules due.");
    return 0;
  }

  logger?.info(`Running ${claimed.length} due schedule(s).`);
  await Promise.all(
    claimed.map(async (schedule) => {
      const runKey = `${dbKey}:${schedule.id}`;
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
          await withDb(dir, (db) => updateScheduleStatus(db, schedule.id, "failed"));
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
    withSpan("scheduler.tick", {}, async (span) => {
      const claimed = await runDueSchedules(options);
      span.setAttributes({ "webfrost.schedules.claimed": claimed });
      return claimed;
    }).catch((err: unknown) => {
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
