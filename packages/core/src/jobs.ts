import { sql } from "kysely";
import { ConcurrencyLimiter, createConcurrencyLimiter } from "./concurrency";
import { type Db, openDb } from "./db";
import {
  JOB_HEARTBEAT_MS,
  JOB_LEASE_SECONDS,
  type Logger,
  createSnapshotJob,
  runPipeline,
} from "./pipeline";
import { newLeaseToken } from "./results";
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

interface InFlightJob {
  promise: Promise<void>;
  /** The job's lease token, once known (see results.ts). */
  lease: string | undefined;
}

/**
 * Runs archive pipelines in the background with bounded concurrency.
 *
 * Every job opens its own database handle and closes it when the pipeline
 * settles, so callers can (and should) close theirs as soon as the snapshot row
 * is inserted. Sharing one connection between an HTTP handler and a background
 * pipeline is what used to leave imported snapshots stuck in `pending`.
 *
 * Jobs are leased through `job_queue.heartbeat_at` and `job_queue.lease_token`:
 * this runner refreshes the heartbeat of everything it has queued or running,
 * `recoverPending()` only adopts jobs whose heartbeat has gone stale, and adopting
 * a job issues a new token, which fences off writes from the previous owner. That
 * is what lets a server and a `webfrost schedule worker` share one archive
 * without stealing — or clobbering — each other's work.
 */
export class JobRunner {
  private readonly limiter: ConcurrencyLimiter;
  private readonly inFlight = new Map<number, InFlightJob>();
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
   * Insert a snapshot row for `url` and queue its pipeline. Resolves with the
   * snapshot id once the row exists; the pipeline runs in the background.
   */
  async add(db: Db, url: string): Promise<number> {
    const { snapshotId, lease } = await createSnapshotJob(db, url);
    void this.enqueue(snapshotId, url, lease);
    return snapshotId;
  }

  /**
   * Queue the pipeline for an existing snapshot. The returned promise settles when
   * the pipeline has finished and never rejects — failures land on the snapshot row.
   *
   * `lease` is the token the job was created or adopted with. Without it the job
   * runs under whatever token the job row holds when the pipeline starts.
   */
  enqueue(snapshotId: number, url: string, lease?: string): Promise<void> {
    const existing = this.inFlight.get(snapshotId);
    if (existing) return existing.promise;

    const entry: InFlightJob = { promise: Promise.resolve(), lease };
    // Wait for the per-host slot before taking a concurrency slot: otherwise a
    // batch of URLs for one host would park every worker in a sleep and stall
    // unrelated hosts behind it.
    entry.promise = this.waitForHost(url)
      .then(() => this.limiter.run(() => this.runOne(snapshotId, url, entry)))
      .catch(async (err: unknown) => {
        const logger = this.options.logger?.(snapshotId);
        logger?.error(
          `pipeline crashed snapshot=${snapshotId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        await this.markFailed(snapshotId, entry.lease);
      })
      .finally(() => {
        this.inFlight.delete(snapshotId);
        if (this.inFlight.size === 0) this.stopHeartbeat();
      });
    this.inFlight.set(snapshotId, entry);
    this.startHeartbeat();
    return entry.promise;
  }

  /**
   * Adopt snapshots that are `pending` but that no live process is working on —
   * left behind by a crash, a deploy or a restart — and queue them here.
   *
   * A job counts as orphaned once its heartbeat is older than the lease, so call
   * this periodically rather than only at startup: right after a crash the dead
   * process's jobs still look alive for up to `JOB_LEASE_SECONDS`.
   *
   * Adoption is atomic: SQLite runs it under BEGIN IMMEDIATE; PostgreSQL and MySQL
   * lock the job rows with SELECT … FOR UPDATE SKIP LOCKED, so two processes
   * recovering at once split the orphans instead of both taking them. Each adopted
   * job gets a new lease token.
   *
   * Partial results of the interrupted run are discarded first, so a snapshot never
   * ends up with duplicate archive results. A job orphaned `MAX_ATTEMPTS` times is
   * marked failed instead of being run again. Resolves with the number re-queued.
   */
  async recoverPending(): Promise<number> {
    const db = await openDb(this.options.dir);
    let adopted: { id: number; url: string; lease: string }[] = [];
    try {
      adopted = await db.transaction(async (tx) => {
        const picked: { id: number; url: string; lease: string }[] = [];
        const stale = tx.ago(JOB_LEASE_SECONDS);
        // Lock order: job_queue first, then snapshots — the same as fenced writes.
        const orphans = await tx.all<{ id: number; url: string; attempts: number | null }>(
          sql`SELECT s.id, s.url, j.attempts
              FROM job_queue j
              JOIN snapshots s ON s.id = j.snapshot_id
              WHERE s.status = 'pending'
                AND (j.heartbeat_at IS NULL OR j.heartbeat_at < ${stale})
              ORDER BY s.id
              ${tx.forUpdateSkipLocked("j")}`,
        );
        // Archives from before the job queue existed can have snapshots without a job row.
        const jobless = await tx.all<{ id: number; url: string }>(
          sql`SELECT s.id, s.url FROM snapshots s
              WHERE s.status = 'pending'
                AND NOT EXISTS (SELECT 1 FROM job_queue j WHERE j.snapshot_id = s.id)
              ORDER BY s.id
              ${tx.forUpdateSkipLocked("s")}`,
        );

        for (const { id, url, attempts } of [
          ...orphans,
          ...jobless.map((r) => ({ ...r, attempts: null })),
        ]) {
          if (this.inFlight.has(id)) continue;

          if ((attempts ?? 0) >= MAX_ATTEMPTS) {
            await tx.run(sql`UPDATE job_queue SET status = 'failed' WHERE snapshot_id = ${id}`);
            await tx.run(sql`UPDATE snapshots SET status = 'failed' WHERE id = ${id}`);
            this.options
              .logger?.(id)
              ?.error(`giving up on snapshot=${id}: interrupted ${attempts} times`);
            continue;
          }

          const lease = newLeaseToken();
          const updated = await tx.run(
            sql`UPDATE job_queue
                SET status = 'pending', heartbeat_at = ${tx.now()}, attempts = attempts + 1, lease_token = ${lease}
                WHERE snapshot_id = ${id}`,
          );
          if (updated === 0) {
            await tx.run(
              sql`INSERT INTO job_queue (snapshot_id, status, heartbeat_at, attempts, lease_token, created_at)
                  VALUES (${id}, 'pending', ${tx.now()}, 1, ${lease}, ${tx.now()})`,
            );
          }
          await tx.run(sql`DELETE FROM archive_results WHERE snapshot_id = ${id}`);
          picked.push({ id, url, lease });
        }
        return picked;
      });
    } finally {
      await db.close();
    }
    for (const { id, url, lease } of adopted) void this.enqueue(id, url, lease);
    return adopted.length;
  }

  /** Resolves when every queued and running job has finished. */
  async onIdle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight.values()].map((j) => j.promise));
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

  private async runOne(snapshotId: number, url: string, entry: InFlightJob): Promise<void> {
    const db = await openDb(this.options.dir);
    try {
      if (entry.lease === undefined) {
        const row = await db.get<{ lease_token: string | null }>(
          sql`SELECT lease_token FROM job_queue WHERE snapshot_id = ${snapshotId} ORDER BY id DESC LIMIT 1`,
        );
        entry.lease = row?.lease_token ?? undefined;
      }
      await runPipeline(
        db,
        snapshotId,
        url,
        this.options.dir,
        undefined,
        this.options.logger?.(snapshotId),
        this.options.storage?.(),
        { throttle: false, ...(entry.lease ? { lease: entry.lease } : {}) },
      );
    } finally {
      await db.close();
    }
  }

  /** Refresh the lease on everything queued or running here, including jobs still waiting for a slot. */
  private async touchInFlight(): Promise<void> {
    if (this.inFlight.size === 0) return;
    const leased: string[] = [];
    const unleased: number[] = [];
    for (const [id, job] of this.inFlight) {
      if (job.lease) leased.push(job.lease);
      else unleased.push(id);
    }
    try {
      const db = await openDb(this.options.dir);
      try {
        // By token: a job another worker has adopted since is not kept alive from here.
        if (leased.length > 0) {
          await db.run(
            sql`UPDATE job_queue SET heartbeat_at = ${db.now()} WHERE lease_token IN (${sql.join(leased)})`,
          );
        }
        if (unleased.length > 0) {
          await db.run(
            sql`UPDATE job_queue SET heartbeat_at = ${db.now()} WHERE snapshot_id IN (${sql.join(unleased)})`,
          );
        }
      } finally {
        await db.close();
      }
    } catch {
      // The archive is unavailable; the jobs themselves will report it.
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => void this.touchInFlight(), JOB_HEARTBEAT_MS);
    // Never keep the process alive just to send heartbeats.
    this.heartbeat.unref?.();
  }

  private stopHeartbeat(): void {
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  private async markFailed(snapshotId: number, lease: string | undefined): Promise<void> {
    try {
      const db = await openDb(this.options.dir);
      try {
        await db.transaction(async (tx) => {
          const fence = lease === undefined ? sql`` : sql`AND lease_token = ${lease}`;
          const changed = await tx.run(
            sql`UPDATE job_queue SET status = 'failed' WHERE snapshot_id = ${snapshotId} AND status != 'done' ${fence}`,
          );
          if (lease !== undefined && changed === 0) return;
          await tx.run(
            sql`UPDATE snapshots SET status = 'failed' WHERE id = ${snapshotId} AND status = 'pending'`,
          );
        });
      } finally {
        await db.close();
      }
    } catch {
      // The archive directory itself is gone or unwritable — nothing left to record.
    }
  }
}
