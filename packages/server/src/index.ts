import { existsSync, mkdirSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { startScheduler } from "@webfrost/core";
import { Elysia } from "elysia";
import { getRunner, getWebfrostDir } from "./context";
import { appContentSecurityPolicy } from "./csp";
import { logger } from "./logger";
import { rateLimiterPlugin } from "./middleware/rateLimiter";
import { authPlugin, authRouter } from "./routes/auth";
import { importRouter, importsRouter } from "./routes/import";
import { schedulesRouter } from "./routes/schedules";
import { settingsRouter } from "./routes/settings";
import { setupRouter } from "./routes/setup";
import { snapshotsRouter } from "./routes/snapshots";
import { statsRouter } from "./routes/stats";
import { snapshotTagsRouter, tagsRouter } from "./routes/tags";

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
  .onRequest(({ request, store }) => {
    (store as Record<string, number>).requestStart = Date.now();
    logger.debug({ method: request.method, path: new URL(request.url).pathname }, "request");
  })
  .onAfterHandle(({ request, set, store }) => {
    const start = (store as Record<string, number | undefined>).requestStart;
    const duration = start !== undefined ? Date.now() - start : undefined;
    const status = set.status ?? 200;
    logger.info(
      { method: request.method, path: new URL(request.url).pathname, status, duration },
      "response",
    );
  })
  .onAfterHandle(({ set }) => {
    // `??=` so a route can ship a stricter policy of its own — the archive preview
    // does, to render untrusted HTML in an opaque, script-less sandbox.
    set.headers["content-security-policy"] ??= appContentSecurityPolicy();
    set.headers["x-content-type-options"] = "nosniff";
    set.headers["x-frame-options"] ??= "DENY";
    set.headers["referrer-policy"] ??= "strict-origin-when-cross-origin";
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

if (import.meta.main) {
  startBackgroundWork();
  app.listen(PORT);
  logger.info({ port: PORT }, "@webfrost/server listening");
}
