import { sql } from "kysely";
import { guardBrowserContext } from "./browser-guard";
import { resolveChromium } from "./chromium";
import type { Db } from "./db";
import { domSnapshotExtractor } from "./extractors/dom-snapshot";
import { htmlExtractor } from "./extractors/html";
import { mediaExtractor } from "./extractors/media";
import { pdfExtractor } from "./extractors/pdf";
import { readabilityExtractor } from "./extractors/readability";
import { screenshotExtractor } from "./extractors/screenshot";
import { singleFileExtractor } from "./extractors/singlefile";
import { warcExtractor } from "./extractors/warc";
import { FetchCache } from "./fetch-cache";
import { newLeaseToken, recordResult, setJobStatus, touchJob } from "./results";
import { extractIndexFields, indexSnapshot } from "./search";
import { envInt } from "./ssrf-guard";
import { createStorageBackend } from "./storage";
import type { StorageBackend } from "./storage";
import {
  type SpanHandle,
  failureCategory,
  recordMetric,
  telemetryEnabled,
  urlAttributes,
  withSpan,
} from "./telemetry";
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
  /**
   * The job lease this run holds (see results.ts). Every status and result write
   * is conditional on it, so a run whose job was adopted by another worker in the
   * meantime cannot overwrite the new run. Omitted: writes are unconditional.
   */
  lease?: string;
}

/** Extractors that need the shared headless-browser page. */
const BROWSER_EXTRACTORS = ["pdf", "screenshot", "dom-snapshot", "singlefile"] as const;

const NAVIGATION_TIMEOUT_MS = 30_000;
/** Longest wait for the network to go quiet after "load"; pages that never go quiet stop here. */
const DEFAULT_SETTLE_MS = 5_000;
/** Per-extractor cap (WEBFROST_EXTRACTOR_TIMEOUT_MS). Media has its own, longer cap. */
const DEFAULT_EXTRACTOR_TIMEOUT_MS = 60_000;
const DEFAULT_MEDIA_TIMEOUT_MS = 10 * 60_000;
/** Closing Chromium normally takes milliseconds; never let a lost exit hold up a pipeline. */
const BROWSER_CLOSE_TIMEOUT_MS = 5_000;
/** How long a timed-out extractor gets to stop after its signal was aborted. */
const ABORT_GRACE_MS = 5_000;

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
 * Launch options for the headless browser. The executable comes from `resolveChromium`:
 * WEBFROST_CHROMIUM_PATH, then the Chromium `webfrost setup` installed, then a system
 * Chrome/Chromium, then Playwright's own default (no path).
 */
export function chromiumLaunchOptions(): { executablePath?: string } {
  const { path } = resolveChromium();
  return path ? { executablePath: path } : {};
}

/** How far down the page the scroll pass goes; past that, a page is endless (a feed) or huge. */
const SCROLL_MAX_PX = 20_000;

/**
 * Scroll from top to bottom one screen at a time, so scroll-triggered reveals and lazy images happen,
 * then back to the top for the captures. Bounded by SCROLL_MAX_PX and a few seconds; a page that fits in
 * one screen is left alone. Resolves true when it scrolled.
 */
export async function scrollThrough(page: import("playwright").Page): Promise<boolean> {
  return page
    .evaluate(async (maxPx) => {
      const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
      const bottom = () => Math.min(document.documentElement.scrollHeight, maxPx);
      if (bottom() <= window.innerHeight) return false;
      const started = Date.now();
      for (let y = step; y < bottom() && Date.now() - started < 8_000; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, bottom());
      await new Promise((r) => setTimeout(r, 300));
      window.scrollTo(0, 0);
      // Reveal transitions (opacity, transform) take a moment to finish.
      await new Promise((r) => setTimeout(r, 600));
      return true;
    }, SCROLL_MAX_PX)
    .catch(() => false);
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

/**
 * Insert a snapshot row and its job, in one transaction. Returns the snapshot id
 * and the lease token the job was issued with.
 */
/** The `prefers-color-scheme` the browser archives a page with. */
export type ColorScheme = "light" | "dark";

export function parseColorScheme(value: unknown): ColorScheme | undefined {
  return value === "light" || value === "dark" ? value : undefined;
}

/** The scheme for snapshots that did not ask for one: WEBFROST_COLOR_SCHEME, else light. */
export function defaultColorScheme(): ColorScheme {
  return parseColorScheme(process.env.WEBFROST_COLOR_SCHEME) ?? "light";
}

export interface SnapshotOptions {
  /** Archive the page as a browser in this theme sees it; omitted: the server default. */
  colorScheme?: ColorScheme | undefined;
}

export async function createSnapshotJob(
  db: Db,
  url: string,
  options?: SnapshotOptions,
): Promise<{ snapshotId: number; lease: string }> {
  return withSpan("job_queue.enqueue", { kind: "producer" }, async (span) => {
    const created = await insertSnapshotJob(db, url, options?.colorScheme ?? null);
    span.setAttributes({ "webfrost.snapshot.id": created.snapshotId });
    return created;
  });
}

async function insertSnapshotJob(
  db: Db,
  url: string,
  colorScheme: ColorScheme | null,
): Promise<{ snapshotId: number; lease: string }> {
  const lease = newLeaseToken();
  const snapshotId = await db.transaction(async (tx) => {
    const id = await tx.insert(
      sql`INSERT INTO snapshots (url, status, created_at, color_scheme) VALUES (${url}, 'pending', ${tx.now()}, ${colorScheme})`,
    );
    // The heartbeat starts the job's lease: whoever created it gets JOB_LEASE_SECONDS
    // to start running it before another process may treat it as orphaned.
    await tx.run(
      sql`INSERT INTO job_queue (snapshot_id, status, heartbeat_at, lease_token, created_at)
          VALUES (${id}, 'pending', ${tx.now()}, ${lease}, ${tx.now()})`,
    );
    return id;
  });
  return { snapshotId, lease };
}

/** Insert a snapshot row and enqueue a job. Returns the new snapshot id. */
export async function createSnapshot(
  db: Db,
  url: string,
  options?: SnapshotOptions,
): Promise<number> {
  return (await createSnapshotJob(db, url, options)).snapshotId;
}

export { touchJob } from "./results";

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
  db: Db,
  snapshotId: number,
  url: string,
  dir: string,
  cache?: FetchCache,
  logger?: Logger,
  storage?: StorageBackend,
  options?: PipelineOptions,
): Promise<void> {
  await withSpan(
    "snapshot.archive",
    { attributes: { "webfrost.snapshot.id": snapshotId, ...urlAttributes(url) } },
    async (span) => {
      // Keep the job's lease alive for as long as this run takes.
      const heartbeat = setInterval(
        () => void touchJob(db, snapshotId, options?.lease),
        JOB_HEARTBEAT_MS,
      );
      try {
        await archive(db, snapshotId, url, dir, span, cache, logger, storage, options);
      } finally {
        clearInterval(heartbeat);
      }
    },
  );
}

async function archive(
  db: Db,
  snapshotId: number,
  url: string,
  dir: string,
  span: SpanHandle,
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

  const lease = options?.lease;

  /** Returns false when the job's lease has passed to another worker. */
  /** `reason`: why the run failed, as a `failureCategory`. */
  async function setStatus(
    status: "running" | "done" | "failed",
    reason?: string,
  ): Promise<boolean> {
    try {
      const owned = await setJobStatus(db, snapshotId, status, lease);
      if (!owned) {
        logger?.warn(
          `lease lost snapshot=${snapshotId}: another worker adopted the job; dropping status=${status}`,
        );
        span.setAttributes({ "webfrost.lease.lost": true });
      } else if (status !== "running") {
        span.setAttributes({ "webfrost.snapshot.status": status });
        if (status === "failed") span.fail(undefined, reason ?? "no_output");
        recordMetric("snapshots.finished", 1, { "webfrost.snapshot.status": status });
      }
      return owned;
    } catch (err) {
      logger?.error(
        `could not record status=${status} snapshot=${snapshotId}: ${errorMessage(err)}`,
      );
      return true;
    }
  }

  async function recordFailure(extractor: string, error: string, durationMs: number) {
    try {
      await recordResult(db, snapshotId, { extractor, error, durationMs }, lease);
    } catch (err) {
      logger?.error(
        `could not record ${extractor} failure snapshot=${snapshotId}: ${errorMessage(err)}`,
      );
    }
  }

  if (!(await setStatus("running"))) return;

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
    cached = await withSpan(
      "page.fetch",
      { kind: "client", attributes: { "http.request.method": "GET", ...urlAttributes(url) } },
      async (fetchSpan) => {
        try {
          const response = await fetchCache.get(url);
          fetchSpan.setAttributes({
            "http.response.status_code": response.status,
            "http.response.body.size": response.body.byteLength,
            "webfrost.fetch.redirects": response.redirects.length,
            "webfrost.fetch.text": response.isText,
          });
          if (!response.status || response.status >= 400) {
            fetchSpan.fail(undefined, String(response.status || "no_status"));
          }
          return response;
        } catch (err) {
          fetchSpan.fail(err, failureCategory(errorMessage(err)));
          throw err;
        }
      },
    );
  } catch (err) {
    logger?.error(`fetch failed snapshot=${snapshotId}: ${errorMessage(err)}`);
    await setStatus("failed", `fetch_${failureCategory(errorMessage(err))}`);
    return;
  }

  if (!cached.status || cached.status >= 400) {
    logger?.warn(`fetch error snapshot=${snapshotId} status=${cached.status ?? "none"} url=${url}`);
    await setStatus("failed", "fetch_http_status");
    return;
  }

  logger?.debug(`fetch ok snapshot=${snapshotId} status=${cached.status}`);

  const { html } = cached;

  // Launch Playwright once for all Playwright-dependent extractors.
  // A single page.goto() is shared — no duplicate browser navigations per snapshot.
  const browserStart = Date.now();
  const navigation = await withSpan(
    "browser.navigate",
    { attributes: urlAttributes(url) },
    async (
      navSpan,
    ): Promise<{
      browser?: import("playwright").Browser;
      page?: import("playwright").Page;
      error: string | null;
    }> => {
      let browser: import("playwright").Browser | undefined;
      try {
        const pw = await import("playwright");
        browser = await pw.chromium.launch(chromiumLaunchOptions());
        const stored = await db.get<{ color_scheme: string | null }>(
          sql`SELECT color_scheme FROM snapshots WHERE id = ${snapshotId}`,
        );
        // Service workers could issue requests that bypass route(); the archive does not need them.
        const context = await browser.newContext({
          serviceWorkers: "block",
          colorScheme: parseColorScheme(stored?.color_scheme) ?? defaultColorScheme(),
        });
        const guard = await guardBrowserContext(context);
        const page = await context.newPage();
        await page.goto(url, { timeout: NAVIGATION_TIMEOUT_MS, waitUntil: "load" });
        // Single-page apps keep loading after "load" (route modules, data): give the network a
        // moment to go quiet before sealing, or the capture is of a half-built page or an
        // error screen. Every request in this window still passes the guard's route() check.
        const settleMs = envInt("WEBFROST_SETTLE_MS", DEFAULT_SETTLE_MS);
        if (settleMs > 0) {
          await page.waitForLoadState("networkidle", { timeout: settleMs }).catch(() => {});
        }
        // Sites reveal sections as they scroll into view (opacity 0 until an IntersectionObserver fires)
        // and load images only near the viewport. Nobody scrolls the archiving browser, so those were
        // archived invisible or missing. Scroll through the page once, then settle again.
        if (await scrollThrough(page)) {
          if (settleMs > 0) {
            await page.waitForLoadState("networkidle", { timeout: settleMs }).catch(() => {});
          }
        }
        // The capture is of the page as loaded. Refusing further requests here also means
        // a script cannot wait for the check below and then pull an internal URL into a frame.
        const violation = await guard.seal();
        if (violation) {
          throw new Error(
            `blocked: page redirected to a non-public address (${new URL(violation).hostname})`,
          );
        }
        logger?.debug(`playwright navigation ok snapshot=${snapshotId}`);
        return { browser, page, error: null };
      } catch (err) {
        // Browser missing, navigation failed or SSRF policy violated: the browser
        // extractors are recorded as failed and the rest of the pipeline carries on.
        const error = errorMessage(err);
        navSpan.fail(err, failureCategory(error));
        logger?.warn(`browser unavailable snapshot=${snapshotId}: ${error}`);
        await closeBrowser(browser);
        return { error };
      }
    },
  );
  const { page, browser } = navigation;
  const browserError = navigation.error;
  const browserSetupMs = Date.now() - browserStart;

  const extractorTimeout = envInt("WEBFROST_EXTRACTOR_TIMEOUT_MS", DEFAULT_EXTRACTOR_TIMEOUT_MS);
  const mediaTimeout = envInt("WEBFROST_MEDIA_TIMEOUT_MS", DEFAULT_MEDIA_TIMEOUT_MS);

  type ExtractorOutcome = { name: string; durationMs: number; error: string | null };

  // Run an extractor so it always resolves with a settled result + elapsed ms.
  // The thunk is invoked inside the promise chain so a synchronous throw is captured too.
  // On timeout the signal is aborted, which cancels the extractor's work (fetches,
  // yt-dlp and its children); the extractor also checks it before storing anything,
  // so no result shows up after the fact. The run is then given a moment to wind
  // down so it does not keep working outside the pipeline's concurrency slot.
  function runTimed(
    name: string,
    fn: (signal: AbortSignal) => unknown,
    timeoutMs = extractorTimeout,
  ): Promise<ExtractorOutcome> {
    return withSpan(
      `extractor.${name}`,
      { attributes: { "webfrost.extractor.format": name } },
      async (extractorSpan) => {
        const t0 = Date.now();
        const controller = new AbortController();
        const run = Promise.resolve().then(() => fn(controller.signal));
        const outcome: ExtractorOutcome = await withTimeout(
          run,
          timeoutMs,
          `extractor ${name}`,
        ).then(
          () => ({ name, durationMs: Date.now() - t0, error: null }),
          async (reason: unknown) => {
            const durationMs = Date.now() - t0;
            controller.abort(reason);
            await withTimeout(run, ABORT_GRACE_MS, `extractor ${name} cancel`).catch(() => {});
            return { name, durationMs, error: errorMessage(reason) };
          },
        );
        if (telemetryEnabled()) await recordExtractorTelemetry(extractorSpan, outcome);
        return outcome;
      },
    );
  }

  /** Outcome, bytes stored and failure category of one extractor, on its span and metrics. */
  async function recordExtractorTelemetry(
    extractorSpan: SpanHandle,
    { name, durationMs, error }: ExtractorOutcome,
  ): Promise<void> {
    const category = error === null ? undefined : failureCategory(error);
    const outcome = error === null ? "ok" : category === "timeout" ? "timeout" : "failed";
    let bytes: number | undefined;
    if (error === null) {
      try {
        const row = await db.get<{ bytes: number | null }>(
          sql`SELECT SUM(size_bytes) AS bytes FROM archive_results WHERE snapshot_id = ${snapshotId} AND extractor = ${name} AND error IS NULL`,
        );
        bytes = row?.bytes == null ? undefined : Number(row.bytes);
      } catch {
        // Sizes are informational only.
      }
    }
    extractorSpan.setAttributes({
      "webfrost.extractor.outcome": outcome,
      "webfrost.extractor.bytes": bytes,
      "webfrost.extractor.failure": category,
    });
    if (category) extractorSpan.fail(undefined, category);
    recordMetric("extractor.duration", durationMs / 1000, {
      "webfrost.extractor.format": name,
      "webfrost.extractor.outcome": outcome,
    });
    if (bytes) recordMetric("archived.bytes", bytes, { "webfrost.extractor.format": name });
  }

  span.setAttributes({
    "webfrost.extractors": [
      ...(cached.isText ? ["html", "readability"] : []),
      "warc",
      "media",
      ...(page ? BROWSER_EXTRACTORS : []),
    ],
    ...(browserError === null ? {} : { "webfrost.browser.failure": failureCategory(browserError) }),
  });

  // HTML and Readability need text; a PDF or an image fetched directly only goes to the WARC.
  const textExtractors = cached.isText
    ? [
        runTimed("html", () => htmlExtractor(db, snapshotId, html, lease)),
        // The final URL (after redirects) is the base for the page's relative links.
        runTimed("readability", () =>
          readabilityExtractor(db, snapshotId, cached.url, html, lease),
        ),
      ]
    : [];
  const textTasks = Promise.all([
    ...textExtractors,
    runTimed("warc", (signal) =>
      warcExtractor(db, snapshotId, cached, effectiveStorage, signal, lease),
    ),
    runTimed(
      "media",
      (signal) =>
        mediaExtractor(db, snapshotId, effectiveStorage, url, {
          ...(logger ? { logger } : {}),
          signal,
          ...(lease ? { lease } : {}),
        }),
      // Three yt-dlp invocations at most (metadata, video, audio fallback), each capped on its own.
      mediaTimeout * 3,
    ),
  ]);

  let browserTasks: Promise<ExtractorOutcome[]>;
  if (page) {
    const p = page;
    const b = browser;
    browserTasks = Promise.all([
      runTimed("pdf", (signal) => pdfExtractor(db, snapshotId, effectiveStorage, p, signal, lease)),
      runTimed("screenshot", (signal) =>
        screenshotExtractor(db, snapshotId, effectiveStorage, p, signal, lease),
      ),
      runTimed("dom-snapshot", (signal) =>
        domSnapshotExtractor(db, snapshotId, effectiveStorage, p, signal, lease),
      ),
      runTimed("singlefile", (signal) =>
        singleFileExtractor(db, snapshotId, effectiveStorage, p, signal, lease),
      ),
      // Close the browser as soon as its extractors are done instead of keeping an
      // idle Chromium around while a long media download finishes.
    ]).finally(() => closeBrowser(b));
  } else {
    // Be explicit about what was skipped instead of silently producing fewer formats.
    for (const name of BROWSER_EXTRACTORS) {
      await recordFailure(
        name,
        `browser unavailable: ${browserError ?? "unknown error"}`,
        browserSetupMs,
      );
      recordMetric("extractor.duration", browserSetupMs / 1000, {
        "webfrost.extractor.format": name,
        "webfrost.extractor.outcome": "skipped",
      });
    }
    browserTasks = Promise.resolve([]);
  }

  // Run all extractors in parallel — partial failure is non-fatal
  // media extractor runs independently of Playwright (no page needed)
  const results = (await Promise.all([textTasks, browserTasks])).flat();
  for (const { name, durationMs, error } of results) {
    if (error !== null) {
      logger?.warn(`extractor ${name} failed snapshot=${snapshotId}: ${error}`);
      await recordFailure(name, error, durationMs);
    } else {
      logger?.debug(`extractor ${name} ok snapshot=${snapshotId} durationMs=${durationMs}`);
      try {
        // Two statements: MySQL cannot UPDATE a table it selects from in a subquery.
        const row = await db.get<{ id: number }>(
          sql`SELECT id FROM archive_results WHERE snapshot_id = ${snapshotId} AND extractor = ${name} AND duration_ms IS NULL ORDER BY id DESC LIMIT 1`,
        );
        if (row) {
          await db.run(
            sql`UPDATE archive_results SET duration_ms = ${durationMs} WHERE id = ${row.id}`,
          );
        }
      } catch {
        // Timing is informational only.
      }
    }
  }

  // A snapshot is only "done" if at least one extractor actually produced output.
  let succeeded = 0;
  try {
    succeeded = Number(
      (
        await db.get<{ n: number }>(
          sql`SELECT COUNT(*) AS n FROM archive_results WHERE snapshot_id = ${snapshotId} AND error IS NULL`,
        )
      )?.n ?? 0,
    );
  } catch (err) {
    logger?.error(`could not read results snapshot=${snapshotId}: ${errorMessage(err)}`);
  }

  if (succeeded === 0) {
    logger?.warn(`no extractor produced output snapshot=${snapshotId}`);
    await setStatus("failed");
    return;
  }

  if (!(await setStatus("done"))) return;

  // Index the snapshot for full-text search
  try {
    const readabilityRow = await db.get<{ content: string | null }>(
      sql`SELECT content FROM archive_results WHERE snapshot_id = ${snapshotId} AND extractor = 'readability' AND error IS NULL ORDER BY id LIMIT 1`,
    );
    const { title, textContent, tags } = await extractIndexFields(
      db,
      snapshotId,
      readabilityRow?.content,
    );
    await indexSnapshot(db, snapshotId, url, title, textContent, tags);
  } catch (err) {
    // FTS indexing failure is non-fatal
    logger?.warn(`search indexing failed snapshot=${snapshotId}: ${errorMessage(err)}`);
  }

  logger?.debug(`pipeline done snapshot=${snapshotId} duration=${Date.now() - start}ms`);
}

/** Convenience: create a snapshot and run the full pipeline synchronously. */
export async function addUrl(
  db: Db,
  url: string,
  dir: string,
  logger?: Logger,
  storage?: StorageBackend,
  options?: SnapshotOptions,
): Promise<number> {
  const { snapshotId, lease } = await createSnapshotJob(db, url, options);
  await runPipeline(db, snapshotId, url, dir, undefined, logger, storage, { lease });
  return snapshotId;
}
