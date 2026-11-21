import { existsSync, mkdirSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { hasAdminUser, startScheduler } from "@webfrost/core";
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
import { installShutdownHandlers, shutdownTimeoutMs } from "./shutdown";

const PORT = Number(process.env.PORT ?? "3000");

/** How often the server looks for snapshots orphaned by an interrupted run. */
const RECOVERY_INTERVAL_MS = 60_000;

// Resolve UI assets: prefer packages/ui/dist (monorepo dev), fall back to ./public (Docker/production)
const uiDistPath = resolve(import.meta.dir, "../../ui/dist");
const fallbackPublicPath = resolve(process.cwd(), "public");
const staticAssetsPath = existsSync(uiDistPath)
  ? uiDistPath
  : existsSync(fallbackPublicPath)
    ? fallbackPublicPath
    : null;

if (!staticAssetsPath) {
  logger.warn(
    "No UI assets found. Run 'bun run build' to build the UI, or 'cd packages/ui && bun run build' for just the UI package.",
  );
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// Refuse to start if auth is enabled but SESSION_SECRET is not configured
if (process.env.AUTH_DISABLED !== "true" && !process.env.SESSION_SECRET) {
  logger.error(
    "SESSION_SECRET env var is required. Set it to a random string of at least 32 characters, or set AUTH_DISABLED=true for development.",
  );
  process.exit(1);
}
if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) {
  logger.warn(
    "SESSION_SECRET is shorter than 32 characters. Generate a strong one with: openssl rand -hex 32",
  );
}

/** Serve a static file from the UI assets directory. Returns null if not found. */
async function serveStaticFile(pathname: string): Promise<Response | null> {
  if (!staticAssetsPath) return null;

  // Map URL path to file path
  const filePath = resolve(
    staticAssetsPath,
    pathname.startsWith("/") ? pathname.slice(1) : pathname,
  );

  // Sandbox: must be within the assets directory
  if (!filePath.startsWith(staticAssetsPath + sep)) return null;

  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
  const cacheControl = pathname.startsWith("/assets/")
    ? "public, max-age=31536000, immutable"
    : "no-cache";

  return new Response(file, {
    headers: { "content-type": contentType, "cache-control": cacheControl },
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
    if (staticAssetsPath) {
      const indexFile = Bun.file(resolve(staticAssetsPath, "index.html"));
      if (await indexFile.exists()) {
        set.headers["content-type"] = "text/html";
        return indexFile;
      }
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
  const recover = () => {
    try {
      const recovered = runner.recoverPending();
      if (recovered > 0) {
        logger.info({ recovered }, "re-queued snapshots left pending by an interrupted run");
      }
    } catch (err) {
      logger.error({ err }, "pending-snapshot recovery failed");
    }
  };
  recover();
  const recovery = setInterval(recover, RECOVERY_INTERVAL_MS);

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
function warnIfSetupUnprotected(): void {
  if (process.env.AUTH_DISABLED === "true" || setupToken() !== null) return;
  const db = getDb();
  try {
    if (hasAdminUser(db)) return;
  } finally {
    db.close();
  }
  logger.warn(
    "No admin user exists yet and WEBFROST_SETUP_TOKEN is not set: anyone who can reach this server can complete first-run setup and become its admin. Finish setup now, or set WEBFROST_SETUP_TOKEN.",
  );
}

if (import.meta.main) {
  const background = startBackgroundWork();
  warnIfSetupUnprotected();
  const hostname = listenHostname();
  app.listen({ port: PORT, hostname, maxRequestBodySize: maxRequestBodyBytes() });
  logger.info({ hostname, port: app.server?.port ?? PORT }, "@webfrost/server listening");
  if (process.env.AUTH_DISABLED === "true" && hostname !== "127.0.0.1" && hostname !== "::1") {
    logger.warn({ hostname }, "AUTH_DISABLED=true on a non-loopback address: anyone can reach it");
  }
  installShutdownHandlers({
    stopServer: () => app.stop(),
    stopBackgroundWork: background.stop,
    runner: getRunner(),
    timeoutMs: shutdownTimeoutMs(),
    logger,
  });
}
