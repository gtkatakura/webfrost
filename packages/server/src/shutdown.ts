import type { Logger } from "pino";

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 20_000;
/** Closing the database pools must never hold up the exit for longer than this. */
const CLOSE_DATABASES_TIMEOUT_MS = 2_000;

/** WEBFROST_SHUTDOWN_TIMEOUT_MS: how long a shutdown waits for requests and archive jobs. */
export function shutdownTimeoutMs(): number {
  const raw = process.env.WEBFROST_SHUTDOWN_TIMEOUT_MS;
  if (!raw) return DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_SHUTDOWN_TIMEOUT_MS;
}

export interface ShutdownDeps {
  /** Stop accepting connections; resolves once in-flight requests are answered. */
  stopServer: () => Promise<unknown> | unknown;
  /** Stop the scheduler and the pending-job recovery sweep. */
  stopBackgroundWork: () => void;
  /** The job runner: `size` jobs in flight, `onIdle()` resolves when none are. */
  runner: { readonly size: number; onIdle(): Promise<void> };
  /** End the database pools; the last step, so nothing is cut off mid-query. */
  closeDatabases?: () => Promise<void>;
  /**
   * Send the spans, metrics and logs still buffered (OpenTelemetry export), after the
   * jobs that produce them are done. Must bound its own duration and never throw.
   */
  flushTelemetry?: () => Promise<void>;
  timeoutMs: number;
  logger: Pick<Logger, "info" | "warn">;
}

/**
 * Stop in an order that loses no work: no new scheduled runs, no new requests, then
 * give running archive jobs until the deadline (`timeoutMs` from the start) to
 * finish. A job cut off by the deadline stays `pending` in the database and is
 * picked up again by the next start's recovery sweep. Connections are per
 * request or per job; the pooled databases (PostgreSQL, MySQL) are ended last, via
 * `closeDatabases`.
 *
 * Resolves to true when everything finished, false when the deadline cut it off.
 */
export async function gracefulShutdown(deps: ShutdownDeps): Promise<boolean> {
  const { runner, timeoutMs, logger } = deps;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    // The scheduler first: it must not start jobs while the server drains.
    deps.stopBackgroundWork();
    const stopped = await Promise.race([
      Promise.resolve(deps.stopServer()).then(() => true),
      deadline,
    ]);
    if (stopped && runner.size > 0) {
      logger.info({ jobs: runner.size, timeoutMs }, "waiting for in-flight archive jobs");
    }
    const finished =
      stopped && (await Promise.race([runner.onIdle().then(() => true as const), deadline]));
    if (!finished) {
      logger.warn(
        { jobs: runner.size },
        "shutdown timeout reached; unfinished jobs stay pending and resume on the next start",
      );
    }
    return finished;
  } finally {
    clearTimeout(timer);
    if (deps.closeDatabases) {
      let closeTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          deps.closeDatabases(),
          new Promise<void>((resolve) => {
            closeTimer = setTimeout(resolve, CLOSE_DATABASES_TIMEOUT_MS);
          }),
        ]);
      } catch (err) {
        logger.warn({ err }, "closing the database pools failed");
      } finally {
        clearTimeout(closeTimer);
      }
    }
    if (deps.flushTelemetry) {
      try {
        await deps.flushTelemetry();
      } catch (err) {
        logger.warn({ err }, "flushing OpenTelemetry data failed");
      }
    }
  }
}

/**
 * Run `gracefulShutdown` on the first SIGTERM/SIGINT, then exit. A second signal
 * while draining exits at once. Returns a function that removes the handlers.
 */
export function installShutdownHandlers(
  deps: ShutdownDeps,
  exit: (code: number) => void = (code) => process.exit(code),
): () => void {
  let shuttingDown = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      deps.logger.warn({ signal }, "second signal during shutdown; exiting now");
      exit(1);
      return;
    }
    shuttingDown = true;
    deps.logger.info({ signal }, "shutting down");
    gracefulShutdown(deps).then(
      () => exit(0),
      () => exit(1),
    );
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  return () => {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
  };
}
