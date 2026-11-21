import type Database from "bun:sqlite";
import { ConcurrencyLimiter, createConcurrencyLimiter } from "./concurrency";
import { openDb } from "./db";
import {
  JOB_HEARTBEAT_MS,
  JOB_LEASE_SECONDS,
  type Logger,
  createSnapshot,
  runPipeline,
} from "./pipeline";
import type { StorageBackend } from "./storage";
import { domainThrottle } from "./throttle";

/** A job that keeps getting orphaned (it crashes the process, say) is given up on after this many runs. */
const MAX_ATTEMPTS = 3;

export interface JobRunnerOptions {
  /** Archive directory (holds archive.db and the snapshots folder). */
  dir: string;
  /** Maximum pipelines running at once. Defaults to WEBFROST_CONCURRENCY (3). */
  concurrency?: number;
  /** Logger factory, called once per job so log lines can carry the snapshot id. */
  logger?: (snapshotId: number) => Logger | undefined;
  /** Storage backend factory. Defaults to the backend configured through the environment. */
  storage?: () => StorageBackend;
}

/**
 * Runs archive pipelines in the background with bounded concurrency.
 *
 * Every job opens its own database connection and closes it when the pipeline
 * settles, so callers can (and should) close theirs as soon as the snapshot row
 * is inserted. Sharing one connection between an HTTP handler and a background
 * pipeline is what used to leave imported snapshots stuck in `pending`.
 *
 * Jobs are leased through `job_queue.heartbeat_at`: this runner refreshes the
 * heartbeat of everything it has queued or running, and `recoverPending()` only
 * adopts jobs whose heartbeat has gone stale. That is what lets a server and a
 * `webfrost schedule worker` share one archive without stealing each other's work.
 */
export class JobRunner {
  private readonly limiter: ConcurrencyLimiter;
  private readonly inFlight = new Map<number, Promise<void>>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly options: JobRunnerOptions) {
    this.limiter = options.concurrency
      ? new ConcurrencyLimiter(options.concurrency)
      : createConcurrencyLimiter();
  }

  get concurrency(): number {
    return this.limiter.limit;
  }

  /** Number of jobs queued or running. */
  get size(): number {
    return this.inFlight.size;
  }

  /**
   * Insert a snapshot row for `url` and queue its pipeline. Returns the snapshot id
   * immediately; the pipeline runs in the background.
   */
  add(db: Database, url: string): number {
    const snapshotId = createSnapshot(db, url);
    this.enqueue(snapshotId, url);
    return snapshotId;
  }

  /**
   * Queue the pipeline for an existing snapshot. The returned promise settles when
   * the pipeline has finished and never rejects — failures land on the snapshot row.
   */
  enqueue(snapshotId: number, url: string): Promise<void> {
    const existing = this.inFlight.get(snapshotId);
    if (existing) return existing;

    // Wait for the per-host slot before taking a concurrency slot: otherwise a
    // batch of URLs for one host would park every worker in a sleep and stall
    // unrelated hosts behind it.
    const job = this.waitForHost(url)
      .then(() => this.limiter.run(() => this.runOne(snapshotId, url)))
      .catch((err: unknown) => {
        const logger = this.options.logger?.(snapshotId);
        logger?.error(
          `pipeline crashed snapshot=${snapshotId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        this.markFailed(snapshotId);
      })
      .finally(() => {
        this.inFlight.delete(snapshotId);
        if (this.inFlight.size === 0) this.stopHeartbeat();
      });
    this.inFlight.set(snapshotId, job);
    this.startHeartbeat();
    return job;
  }

  /**
   * Adopt snapshots that are `pending` but that no live process is working on —
   * left behind by a crash, a deploy or a restart — and queue them here.
   *
   * A job counts as orphaned once its heartbeat is older than the lease, so call
   * this periodically rather than only at startup: right after a crash the dead
   * process's jobs still look alive for up to `JOB_LEASE_SECONDS`.
   *
   * Partial results of the interrupted run are discarded first, so a snapshot never
   * ends up with duplicate archive results. A job orphaned `MAX_ATTEMPTS` times is
   * marked failed instead of being run again. Returns the number re-queued.
   */
  recoverPending(): number {
    const db = openDb(this.options.dir);
    const adopted: { id: number; url: string }[] = [];
    try {
      // IMMEDIATE: two processes recovering at once must not adopt the same job.
      db.transaction(() => {
        const orphans = db
          .query<{ id: number; url: string; attempts: number | null }, []>(
            `SELECT s.id, s.url, j.attempts
             FROM snapshots s
             LEFT JOIN job_queue j ON j.snapshot_id = s.id
             WHERE s.status = 'pending'
               AND (j.heartbeat_at IS NULL
                    OR j.heartbeat_at < datetime('now', '-${JOB_LEASE_SECONDS} seconds'))
             ORDER BY s.id`,
          )
          .all();

        for (const { id, url, attempts } of orphans) {
          if (this.inFlight.has(id)) continue;

          if ((attempts ?? 0) >= MAX_ATTEMPTS) {
            db.query<null, [number]>("UPDATE snapshots SET status = 'failed' WHERE id = ?").run(id);
            db.query<null, [number]>(
              "UPDATE job_queue SET status = 'failed' WHERE snapshot_id = ?",
            ).run(id);
            this.options
              .logger?.(id)
              ?.error(`giving up on snapshot=${id}: interrupted ${attempts} times`);
            continue;
          }

          db.query<null, [number]>("DELETE FROM archive_results WHERE snapshot_id = ?").run(id);
          const job = db
            .query<null, [number]>(
              "UPDATE job_queue SET status = 'pending', heartbeat_at = datetime('now'), attempts = attempts + 1 WHERE snapshot_id = ?",
            )
            .run(id);
          if (job.changes === 0) {
            db.query<null, [number]>(
              "INSERT INTO job_queue (snapshot_id, status, heartbeat_at, attempts) VALUES (?, 'pending', datetime('now'), 1)",
            ).run(id);
          }
          adopted.push({ id, url });
        }
      }).immediate();
    } finally {
      db.close();
    }
    for (const { id, url } of adopted) this.enqueue(id, url);
    return adopted.length;
  }

  /** Resolves when every queued and running job has finished. */
  async onIdle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight.values()]);
    }
  }

  private async waitForHost(url: string): Promise<void> {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return; // The pipeline reports the invalid URL.
    }
    await domainThrottle.wait(host);
  }

  private async runOne(snapshotId: number, url: string): Promise<void> {
    const db = openDb(this.options.dir);
    try {
      await runPipeline(
        db,
        snapshotId,
        url,
        this.options.dir,
        undefined,
        this.options.logger?.(snapshotId),
        this.options.storage?.(),
        { throttle: false },
      );
    } finally {
      db.close();
    }
  }

  /** Refresh the lease on everything queued or running here, including jobs still waiting for a slot. */
  private touchInFlight(): void {
    if (this.inFlight.size === 0) return;
    try {
      const db = openDb(this.options.dir);
      try {
        const ids = [...this.inFlight.keys()];
        db.query<null, number[]>(
          `UPDATE job_queue SET heartbeat_at = datetime('now') WHERE snapshot_id IN (${ids.map(() => "?").join(",")})`,
        ).run(...ids);
      } finally {
        db.close();
      }
    } catch {
      // The archive is unavailable; the jobs themselves will report it.
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => this.touchInFlight(), JOB_HEARTBEAT_MS);
    // Never keep the process alive just to send heartbeats.
    this.heartbeat.unref?.();
  }

  private stopHeartbeat(): void {
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  private markFailed(snapshotId: number): void {
    try {
      const db = openDb(this.options.dir);
      try {
        db.query<null, [number]>(
          "UPDATE snapshots SET status = 'failed' WHERE id = ? AND status = 'pending'",
        ).run(snapshotId);
        db.query<null, [number]>(
          "UPDATE job_queue SET status = 'failed' WHERE snapshot_id = ? AND status != 'done'",
        ).run(snapshotId);
      } finally {
        db.close();
      }
    } catch {
      // The archive directory itself is gone or unwritable — nothing left to record.
    }
  }
}
