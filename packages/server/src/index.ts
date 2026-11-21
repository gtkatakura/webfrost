import { mkdirSync } from "node:fs";
import { closeDatabases, hasAdminUser, startScheduler } from "@webfrost/core";
import { Elysia } from "elysia";
import { getDb, getRunner, getWebfrostDir } from "./context";
import { appContentSecurityPolicy } from "./csp";
import { apiErrorHandler, withErrorCode } from "./errors";
import { maxRequestBodyBytes } from "./limits";
import { logger } from "./logger";
import { rateLimiterPlugin } from "./middleware/rateLimiter";
import { requestGuardPlugin } from "./middleware/requestGuard";
import { authPlugin, authRouter } from "./routes/auth";
import { importRouter, importsRouter } from "./routes/import";
import { schedulesRouter } from "./routes/schedules";
import { settingsRouter } from "./routes/settings";
import { setupRouter, setupToken } from "./routes/setup";
import { snapshotsRouter } from "./routes/snapshots";
import { statsRouter } from "./routes/stats";
import { snapshotTagsRouter, tagsRouter } from "./routes/tags";
import { gracefulShutdown, installShutdownHandlers, shutdownTimeoutMs } from "./shutdown";
import { type UiAssets, defaultUiAssets, mimeTypeFor } from "./ui-assets";

export type { UiAssets } from "./ui-assets";
export { directoryAssets, embeddedAssets } from "./ui-assets";

/** How often the server looks for snapshots orphaned by an interrupted run. */
const RECOVERY_INTERVAL_MS = 60_000;

// The UI's static files. Resolved on first use (a directory of a monorepo checkout or ./public)
// unless startServer() was given something else, such as the files embedded in a binary.
let uiAssets: UiAssets | null | undefined;
let warnedNoUi = false;

/** Choose where the UI's static files come from. `null` means none; undefined restores auto-detection. */
export function setUiAssets(assets: UiAssets | null | undefined): void {
  uiAssets = assets;
}

function currentUiAssets(): UiAssets | null {
  if (uiAssets !== undefined) return uiAssets;
  const found = defaultUiAssets();
  if (!found && !warnedNoUi) {
    warnedNoUi = true;
    logger.warn(
      "No UI assets found. Run 'bun run build' to build the UI, or 'cd packages/ui && bun run build' for just the UI package.",
    );
  }
  return found;
}

/** Refuse to start when auth is on but there is no SESSION_SECRET to sign sessions with. */
function checkSessionSecret(): void {
  if (process.env.AUTH_DISABLED !== "true" && !process.env.SESSION_SECRET) {
    throw new StartupError(
      "SESSION_SECRET env var is required. Set it to a random string of at least 32 characters, or set AUTH_DISABLED=true for development.",
    );
  }
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) {
    logger.warn(
      "SESSION_SECRET is shorter than 32 characters. Generate a strong one with: openssl rand -hex 32",
    );
  }
}

/** A configuration problem that stops the server from starting. */
export class StartupError extends Error {}

/** Serve a static file from the UI assets. Returns null if not found. */
async function serveStaticFile(pathname: string): Promise<Response | null> {
  const assets = currentUiAssets();
  if (!assets) return null;
  const file = await assets.find(pathname);
  if (!file) return null;
  const cacheControl = pathname.startsWith("/assets/")
    ? "public, max-age=31536000, immutable"
    : "no-cache";
  return new Response(file, {
    headers: { "content-type": mimeTypeFor(pathname), "cache-control": cacheControl },
  });
}

export const app = new Elysia()
  .onRequest(({ request, store, set }) => {
    (store as Record<string, number>).requestStart = Date.now();
    logger.debug({ method: request.method, path: new URL(request.url).pathname }, "request");
    // Set before routing so every response carries them — errors, 404s and requests
    // refused before a route runs included. A route may still assign a stricter
    // policy of its own: the archive preview does, to render untrusted HTML in an
    // opaque, script-less sandbox.
    set.headers["content-security-policy"] = appContentSecurityPolicy();
    set.headers["x-content-type-options"] = "nosniff";
    set.headers["x-frame-options"] = "DENY";
    set.headers["referrer-policy"] = "strict-origin-when-cross-origin";
  })
  // CSRF and content-type checks, before any body is parsed.
  .use(requestGuardPlugin)
  // Malformed JSON, failed validation, unknown routes and thrown errors → { error, code }.
  .onError(apiErrorHandler)
  .onAfterHandle(({ request, set, store, response }) => {
    const start = (store as Record<string, number | undefined>).requestStart;
    const duration = start !== undefined ? Date.now() - start : undefined;
    const status = typeof set.status === "number" ? set.status : 200;
    logger.info(
      { method: request.method, path: new URL(request.url).pathname, status, duration },
      "response",
    );
    // Give every `{ error }` a route returns a machine-readable `code` as well.
    const coded = withErrorCode(response, status);
    return coded === response ? undefined : coded;
  })
  .get("/health", () => ({ status: "ok" }))
  .group("/api", (app) =>
    app
      .use(authPlugin)
      // Limits are per client IP and scoped by path, because a rate-limiter hook is
      // global: without `path` it would also count requests to unrelated routes.
      // 300 req/min for reads across the API.
      .use(
        rateLimiterPlugin({
          limit: 300,
          windowMs: 60_000,
          methods: ["GET", "HEAD"],
          path: /^\/api\//,
        }),
      )
      // 60 req/min for the endpoints that start archive pipelines.
      .use(
        rateLimiterPlugin({
          limit: 60,
          windowMs: 60_000,
          methods: ["POST"],
          path: /^\/api\/(snapshots|import(\/file)?)\/?$/,
        }),
      )
      // 10 req/min for anything that checks a password — slows down brute force.
      .use(
        rateLimiterPlugin({
          limit: 10,
          windowMs: 60_000,
          methods: ["POST"],
          path: /^\/api\/(auth\/login|auth\/change-password|setup)\/?$/,
        }),
      )
      .use(setupRouter)
      .use(authRouter)
      .use(snapshotsRouter)
      .use(snapshotTagsRouter)
      .use(schedulesRouter)
      .use(tagsRouter)
      .use(importRouter)
      .use(importsRouter)
      .use(settingsRouter)
      .use(statsRouter),
  )
  .get("/*", async ({ set, request }) => {
    const url = new URL(request.url);
    // An unknown API route is an API error, not a page of the single-page app.
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      set.status = 404;
      return { error: "not found", code: "NOT_FOUND" };
    }
    // Try to serve the exact static file first (e.g. /assets/index-xxx.js)
    const staticResp = await serveStaticFile(url.pathname);
    if (staticResp) {
      set.headers["content-type"] =
        staticResp.headers.get("content-type") ?? "application/octet-stream";
      set.headers["cache-control"] = staticResp.headers.get("cache-control") ?? "no-cache";
      return staticResp;
    }
    // SPA fallback: serve index.html for all other routes
    const indexFile = await currentUiAssets()?.find("/index.html");
    if (indexFile) {
      set.headers["content-type"] = "text/html";
      return indexFile;
    }
    set.status = 404;
    return "Not Found";
  });

/**
 * Start the background work the HTTP API depends on:
 * - re-queue snapshots an interrupted process left `pending` (crash, deploy, restart),
 *   at startup and every minute after;
 * - run due schedules, so schedules created in the UI fire without a separate
 *   `webfrost schedule worker` process. Set WEBFROST_SCHEDULER=false to disable
 *   it when a dedicated worker already polls the same archive.
 */
export function startBackgroundWork(): { stop: () => void } {
  const dir = getWebfrostDir();
  mkdirSync(dir, { recursive: true });

  const runner = getRunner();
  // A job is only adopted once its heartbeat has gone stale, so that a job another
  // process is still running (a CLI worker, a rolling restart) is left alone. Right
  // after a crash the dead process's jobs still look alive for a few seconds —
  // hence the periodic sweep rather than a single pass at startup.
  let sweeping = false;
  const recover = async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      const recovered = await runner.recoverPending();
      if (recovered > 0) {
        logger.info({ recovered }, "re-queued snapshots left pending by an interrupted run");
      }
    } catch (err) {
      logger.error({ err }, "pending-snapshot recovery failed");
    } finally {
      sweeping = false;
    }
  };
  void recover();
  const recovery = setInterval(() => void recover(), RECOVERY_INTERVAL_MS);

  if (process.env.WEBFROST_SCHEDULER === "false") {
    logger.info("WEBFROST_SCHEDULER=false — schedules are not run by this process");
    return { stop: () => clearInterval(recovery) };
  }

  const scheduler = startScheduler({ dir, runner, logger });
  logger.info({ concurrency: runner.concurrency }, "scheduler started");
  return {
    stop: () => {
      clearInterval(recovery);
      scheduler.stop();
    },
  };
}

/**
 * The address to listen on. HOST wins when set; otherwise 0.0.0.0, except with
 * AUTH_DISABLED=true, where an unauthenticated server must not be reachable from the
 * network by accident: it binds to 127.0.0.1 unless HOST says otherwise.
 */
export function listenHostname(env: Record<string, string | undefined> = process.env): string {
  if (env.HOST) return env.HOST;
  return env.AUTH_DISABLED === "true" ? "127.0.0.1" : "0.0.0.0";
}

/** Warn when a fresh instance can be claimed by anyone who reaches POST /api/setup. */
async function warnIfSetupUnprotected(): Promise<void> {
  if (process.env.AUTH_DISABLED === "true" || setupToken() !== null) return;
  const db = await getDb();
  try {
    if (await hasAdminUser(db)) return;
  } finally {
    await db.close();
  }
  logger.warn(
    "No admin user exists yet and WEBFROST_SETUP_TOKEN is not set: anyone who can reach this server can complete first-run setup and become its admin. Finish setup now, or set WEBFROST_SETUP_TOKEN.",
  );
}

export interface StartServerOptions {
  /** The UI's static files; defaults to the monorepo's packages/ui/dist or ./public. */
  uiAssets?: UiAssets | null | undefined;
  /** Handle SIGINT/SIGTERM with a graceful shutdown, then exit the process (default true). */
  installSignalHandlers?: boolean;
}

export interface RunningServer {
  port: number;
  hostname: string;
  /** Stop the scheduler and the HTTP listener, then wait for running archive jobs. */
  stop: () => Promise<void>;
}

/**
 * Start the HTTP server, the web UI, the scheduler and the pending-job recovery sweep in
 * this process. Configured by the environment (PORT, HOST, SESSION_SECRET, WEBFROST_DIR...).
 * Throws StartupError when the configuration is unusable.
 */
export function startServer(options: StartServerOptions = {}): RunningServer {
  checkSessionSecret();
  if (options.uiAssets !== undefined) setUiAssets(options.uiAssets);
  const background = startBackgroundWork();
  // Only a log line: never hold up the listener for it.
  void warnIfSetupUnprotected().catch((err) =>
    logger.warn({ err }, "could not check whether an admin user exists"),
  );
  const hostname = listenHostname();
  const port = Number(process.env.PORT ?? "3000");
  app.listen({ port, hostname, maxRequestBodySize: maxRequestBodyBytes() });
  const boundPort = app.server?.port ?? port;
  logger.info({ hostname, port: boundPort }, "@webfrost/server listening");
  if (process.env.AUTH_DISABLED === "true" && hostname !== "127.0.0.1" && hostname !== "::1") {
    logger.warn({ hostname }, "AUTH_DISABLED=true on a non-loopback address: anyone can reach it");
  }
  const shutdownDeps = {
    stopServer: () => app.stop(),
    stopBackgroundWork: background.stop,
    runner: getRunner(),
    closeDatabases,
    timeoutMs: shutdownTimeoutMs(),
    logger,
  };
  if (options.installSignalHandlers !== false) installShutdownHandlers(shutdownDeps);
  return {
    port: boundPort,
    hostname,
    stop: async () => {
      await gracefulShutdown(shutdownDeps);
    },
  };
}

if (import.meta.main) {
  try {
    startServer();
  } catch (err) {
    if (err instanceof StartupError) {
      logger.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
