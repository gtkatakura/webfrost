import type Database from "bun:sqlite";
import { guardBrowserContext } from "./browser-guard";
import { domSnapshotExtractor } from "./extractors/dom-snapshot";
import { htmlExtractor } from "./extractors/html";
import { mediaExtractor } from "./extractors/media";
import { pdfExtractor } from "./extractors/pdf";
import { readabilityExtractor } from "./extractors/readability";
import { screenshotExtractor } from "./extractors/screenshot";
import { singleFileExtractor } from "./extractors/singlefile";
import { warcExtractor } from "./extractors/warc";
import { FetchCache } from "./fetch-cache";
import { extractIndexFields, indexSnapshot } from "./search";
import { envInt } from "./ssrf-guard";
import { createStorageBackend } from "./storage";
import type { StorageBackend } from "./storage";
import { domainThrottle } from "./throttle";

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface PipelineOptions {
  /**
   * Wait for the per-host politeness slot before fetching (default true).
   * `JobRunner` passes false because it already waited — outside its concurrency
   * slot, so a burst of URLs for one host does not hold up every other host.
   */
  throttle?: boolean;
}

/** Extractors that need the shared headless-browser page. */
const BROWSER_EXTRACTORS = ["pdf", "screenshot", "dom-snapshot", "singlefile"] as const;

const NAVIGATION_TIMEOUT_MS = 30_000;
/** Per-extractor cap (WEBFROST_EXTRACTOR_TIMEOUT_MS). Media has its own, longer cap. */
const DEFAULT_EXTRACTOR_TIMEOUT_MS = 60_000;
const DEFAULT_MEDIA_TIMEOUT_MS = 10 * 60_000;
/** Closing Chromium normally takes milliseconds; never let a lost exit hold up a pipeline. */
const BROWSER_CLOSE_TIMEOUT_MS = 5_000;

/**
 * How often a running pipeline refreshes `job_queue.heartbeat_at`. Recovery of
 * orphaned jobs (`JobRunner.recoverPending`) only touches jobs whose heartbeat is
 * older than `JOB_LEASE_SECONDS`, so a job that is alive in any process is left alone.
 */
export const JOB_HEARTBEAT_MS = 10_000;
export const JOB_LEASE_SECONDS = 45;

/** Reject with a timeout error if `p` has not settled after `ms` (0 disables the cap). */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  if (ms <= 0) return p;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  // The loser of the race may still reject later; that must not surface as unhandled.
  p.catch(() => {});
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Launch options for the headless browser. WEBFROST_CHROMIUM_PATH points Playwright
 * at an existing Chromium/Chrome binary (distro package, container base image)
 * instead of the build downloaded by `playwright install chromium`.
 */
export function chromiumLaunchOptions(): { executablePath?: string } {
  const executablePath = process.env.WEBFROST_CHROMIUM_PATH;
  return executablePath ? { executablePath } : {};
}

/** Close the browser, giving up (and killing nothing else) if it does not confirm in time. */
async function closeBrowser(browser: import("playwright").Browser | undefined): Promise<void> {
  if (!browser) return;
  await withTimeout(browser.close(), BROWSER_CLOSE_TIMEOUT_MS, "browser close").catch(() => {});
}

function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Playwright appends multi-line banners and call logs; the first line is the actual cause.
  return msg.split("\n")[0]?.trim() || "unknown error";
}

/** Insert a snapshot row and enqueue a job. Returns the new snapshot id. */
export function createSnapshot(db: Database, url: string): number {
  const row = db
    .query<{ id: number }, [string]>(
      "INSERT INTO snapshots (url, status) VALUES (?, 'pending') RETURNING id",
    )
    .get(url);

  if (!row) throw new Error("Failed to insert snapshot");

  // The heartbeat starts the job's lease: whoever created it gets JOB_LEASE_SECONDS
  // to start running it before another process may treat it as orphaned.
  db.query<null, [number]>(
    "INSERT INTO job_queue (snapshot_id, status, heartbeat_at) VALUES (?, 'pending', datetime('now'))",
  ).run(row.id);

  return row.id;
}

/** Refresh the lease on a job. Safe to call on a closed or unavailable database. */
export function touchJob(db: Database, snapshotId: number): void {
  try {
    db.query<null, [number]>(
      "UPDATE job_queue SET heartbeat_at = datetime('now') WHERE snapshot_id = ?",
    ).run(snapshotId);
  } catch {
    // Lease refresh is best effort; the pipeline's own writes report real problems.
  }
}

/**
 * Run the full archive pipeline for an existing snapshot id.
 *
 * Never throws for an archiving failure: the outcome is written to the snapshot
 * row (`done` when at least one extractor produced output, otherwise `failed`)
 * and each extractor's error is recorded in `archive_results.error`.
 *
 * `db` must stay open until the returned promise settles.
 */
export async function runPipeline(
  db: Database,
  snapshotId: number,
  url: string,
  dir: string,
  cache?: FetchCache,
  logger?: Logger,
  storage?: StorageBackend,
  options?: PipelineOptions,
): Promise<void> {
  // Keep the job's lease alive for as long as this run takes.
  const heartbeat = setInterval(() => touchJob(db, snapshotId), JOB_HEARTBEAT_MS);
  try {
    await archive(db, snapshotId, url, dir, cache, logger, storage, options);
  } finally {
    clearInterval(heartbeat);
  }
}

async function archive(
  db: Database,
  snapshotId: number,
  url: string,
  dir: string,
  cache?: FetchCache,
  logger?: Logger,
  storage?: StorageBackend,
  options?: PipelineOptions,
): Promise<void> {
  const start = Date.now();
  const effectiveStorage = storage ?? createStorageBackend(dir);

  logger?.debug(`pipeline start snapshot=${snapshotId} url=${url}`);

  // Use the provided shared cache, or create a one-shot cache for this run
  const fetchCache = cache ?? new FetchCache();

  function setStatus(status: "running" | "done" | "failed") {
    try {
      if (status !== "running") {
        db.query<null, [string, number]>("UPDATE snapshots SET status = ? WHERE id = ?").run(
          status,
          snapshotId,
        );
      }
      db.query<null, [string, number]>(
        "UPDATE job_queue SET status = ?, heartbeat_at = datetime('now') WHERE snapshot_id = ?",
      ).run(status, snapshotId);
    } catch (err) {
      logger?.error(
        `could not record status=${status} snapshot=${snapshotId}: ${errorMessage(err)}`,
      );
    }
  }

  function recordFailure(extractor: string, error: string, durationMs: number) {
    try {
      db.query<null, [number, string, string, number]>(
        "INSERT INTO archive_results (snapshot_id, extractor, error, duration_ms) VALUES (?, ?, ?, ?)",
      ).run(snapshotId, extractor, error, durationMs);
    } catch (err) {
      logger?.error(
        `could not record ${extractor} failure snapshot=${snapshotId}: ${errorMessage(err)}`,
      );
    }
  }

  setStatus("running");

  // Politeness: never start two runs against the same host closer than the configured gap.
  if (options?.throttle !== false) {
    try {
      await domainThrottle.wait(new URL(url).hostname);
    } catch {
      // Unparseable URL — the fetch below reports it.
    }
  }

  let cached: Awaited<ReturnType<FetchCache["get"]>>;
  try {
    cached = await fetchCache.get(url);
  } catch (err) {
    logger?.error(`fetch failed snapshot=${snapshotId}: ${errorMessage(err)}`);
    setStatus("failed");
    return;
  }

  if (!cached.status || cached.status >= 400) {
    logger?.warn(`fetch error snapshot=${snapshotId} status=${cached.status ?? "none"} url=${url}`);
    setStatus("failed");
    return;
  }

  logger?.debug(`fetch ok snapshot=${snapshotId} status=${cached.status}`);

  const { html } = cached;

  // Launch Playwright once for all Playwright-dependent extractors.
  // A single page.goto() is shared — no duplicate browser navigations per snapshot.
  let page: import("playwright").Page | undefined;
  let browser: import("playwright").Browser | undefined;
  let browserError: string | null = null;
  const browserStart = Date.now();
  try {
    const pw = await import("playwright");
    browser = await pw.chromium.launch(chromiumLaunchOptions());
    // Service workers could issue requests that bypass route(); the archive does not need them.
    const context = await browser.newContext({ serviceWorkers: "block" });
    const guard = await guardBrowserContext(context);
    page = await context.newPage();
    await page.goto(url, { timeout: NAVIGATION_TIMEOUT_MS, waitUntil: "load" });
    // The capture is of the page as loaded. Refusing further requests here also means
    // a script cannot wait for the check below and then pull an internal URL into a frame.
    const violation = await guard.seal();
    if (violation) {
      throw new Error(
        `blocked: page redirected to a non-public address (${new URL(violation).hostname})`,
      );
    }
    logger?.debug(`playwright navigation ok snapshot=${snapshotId}`);
  } catch (err) {
    // Browser missing, navigation failed or SSRF policy violated: the browser
    // extractors are recorded as failed and the rest of the pipeline carries on.
    browserError = errorMessage(err);
    logger?.warn(`browser unavailable snapshot=${snapshotId}: ${browserError}`);
    await closeBrowser(browser);
    browser = undefined;
    page = undefined;
  }
  const browserSetupMs = Date.now() - browserStart;

  const extractorTimeout = envInt("WEBFROST_EXTRACTOR_TIMEOUT_MS", DEFAULT_EXTRACTOR_TIMEOUT_MS);
  const mediaTimeout = envInt("WEBFROST_MEDIA_TIMEOUT_MS", DEFAULT_MEDIA_TIMEOUT_MS);

  type ExtractorOutcome = { name: string; durationMs: number; error: string | null };

  // Run an extractor so it always resolves with a settled result + elapsed ms.
  // The thunk is invoked inside the promise chain so a synchronous throw is captured too.
  // On timeout the signal is aborted: the extractor may still be running, but it
  // checks the signal before storing anything, so no result shows up after the fact.
  function runTimed(
    name: string,
    fn: (signal: AbortSignal) => unknown,
    timeoutMs = extractorTimeout,
  ): Promise<ExtractorOutcome> {
    const t0 = Date.now();
    const controller = new AbortController();
    const run = Promise.resolve().then(() => fn(controller.signal));
    return withTimeout(run, timeoutMs, `extractor ${name}`).then(
      () => ({ name, durationMs: Date.now() - t0, error: null }),
      (reason: unknown) => {
        controller.abort();
        return { name, durationMs: Date.now() - t0, error: errorMessage(reason) };
      },
    );
  }

  // HTML and Readability need text; a PDF or an image fetched directly only goes to the WARC.
  const textExtractors = cached.isText
    ? [
        runTimed("html", () => htmlExtractor(db, snapshotId, html)),
        // The final URL (after redirects) is the base for the page's relative links.
        runTimed("readability", () => readabilityExtractor(db, snapshotId, cached.url, html)),
      ]
    : [];
  const textTasks = Promise.all([
    ...textExtractors,
    runTimed("warc", (signal) => warcExtractor(db, snapshotId, cached, effectiveStorage, signal)),
    runTimed(
      "media",
      (signal) =>
        mediaExtractor(db, snapshotId, effectiveStorage, url, {
          ...(logger ? { logger } : {}),
          signal,
        }),
      // Three yt-dlp invocations at most (probe, video, audio fallback), each capped on its own.
      mediaTimeout * 3,
    ),
  ]);

  let browserTasks: Promise<ExtractorOutcome[]>;
  if (page) {
    const p = page;
    const b = browser;
    browserTasks = Promise.all([
      runTimed("pdf", (signal) => pdfExtractor(db, snapshotId, effectiveStorage, p, signal)),
      runTimed("screenshot", (signal) =>
        screenshotExtractor(db, snapshotId, effectiveStorage, p, signal),
      ),
      runTimed("dom-snapshot", (signal) =>
        domSnapshotExtractor(db, snapshotId, effectiveStorage, p, signal),
      ),
      runTimed("singlefile", (signal) =>
        singleFileExtractor(db, snapshotId, effectiveStorage, p, signal),
      ),
      // Close the browser as soon as its extractors are done instead of keeping an
      // idle Chromium around while a long media download finishes.
    ]).finally(() => closeBrowser(b));
  } else {
    // Be explicit about what was skipped instead of silently producing fewer formats.
    for (const name of BROWSER_EXTRACTORS) {
      recordFailure(
        name,
        `browser unavailable: ${browserError ?? "unknown error"}`,
        browserSetupMs,
      );
    }
    browserTasks = Promise.resolve([]);
  }

  // Run all extractors in parallel — partial failure is non-fatal
  // media extractor runs independently of Playwright (no page needed)
  const results = (await Promise.all([textTasks, browserTasks])).flat();
  for (const { name, durationMs, error } of results) {
    if (error !== null) {
      logger?.warn(`extractor ${name} failed snapshot=${snapshotId}: ${error}`);
      recordFailure(name, error, durationMs);
    } else {
      logger?.debug(`extractor ${name} ok snapshot=${snapshotId} durationMs=${durationMs}`);
      try {
        db.query<null, [number, number, string]>(
          "UPDATE archive_results SET duration_ms = ? WHERE id = (SELECT id FROM archive_results WHERE snapshot_id = ? AND extractor = ? AND duration_ms IS NULL ORDER BY id DESC LIMIT 1)",
        ).run(durationMs, snapshotId, name);
      } catch {
        // Timing is informational only.
      }
    }
  }

  // A snapshot is only "done" if at least one extractor actually produced output.
  let succeeded = 0;
  try {
    succeeded =
      db
        .query<{ n: number }, [number]>(
          "SELECT COUNT(*) AS n FROM archive_results WHERE snapshot_id = ? AND error IS NULL",
        )
        .get(snapshotId)?.n ?? 0;
  } catch (err) {
    logger?.error(`could not read results snapshot=${snapshotId}: ${errorMessage(err)}`);
  }

  if (succeeded === 0) {
    logger?.warn(`no extractor produced output snapshot=${snapshotId}`);
    setStatus("failed");
    return;
  }

  setStatus("done");

  // Index the snapshot for full-text search
  try {
    const readabilityRow = db
      .query<{ content: string | null }, [number]>(
        "SELECT content FROM archive_results WHERE snapshot_id = ? AND extractor = 'readability' AND error IS NULL LIMIT 1",
      )
      .get(snapshotId);
    const { title, textContent, tags } = extractIndexFields(
      db,
      snapshotId,
      readabilityRow?.content,
    );
    indexSnapshot(db, snapshotId, url, title, textContent, tags);
  } catch (err) {
    // FTS indexing failure is non-fatal
    logger?.warn(`search indexing failed snapshot=${snapshotId}: ${errorMessage(err)}`);
  }

  logger?.debug(`pipeline done snapshot=${snapshotId} duration=${Date.now() - start}ms`);
}

/** Convenience: create a snapshot and run the full pipeline synchronously. */
export async function addUrl(
  db: Database,
  url: string,
  dir: string,
  logger?: Logger,
  storage?: StorageBackend,
): Promise<number> {
  const snapshotId = createSnapshot(db, url);
  await runPipeline(db, snapshotId, url, dir, undefined, logger, storage);
  return snapshotId;
}
