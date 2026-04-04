import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { Elysia } from "elysia";
import { logger } from "./logger";
import { rateLimiterPlugin } from "./middleware/rateLimiter";
import { authPlugin, authRouter } from "./routes/auth";
import { importRouter } from "./routes/import";
import { schedulesRouter } from "./routes/schedules";
import { settingsRouter } from "./routes/settings";
import { setupRouter } from "./routes/setup";
import { snapshotsRouter } from "./routes/snapshots";
import { statsRouter } from "./routes/stats";
import { snapshotTagsRouter, tagsRouter } from "./routes/tags";

const PORT = Number(process.env.PORT ?? "3000");

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

/** Serve a static file from the UI assets directory. Returns null if not found. */
async function serveStaticFile(pathname: string): Promise<Response | null> {
  if (!staticAssetsPath) return null;

  // Map URL path to file path
  const filePath = resolve(
    staticAssetsPath,
    pathname.startsWith("/") ? pathname.slice(1) : pathname,
  );

  // Sandbox: must be within the assets directory
  if (!filePath.startsWith(staticAssetsPath)) return null;

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
    set.headers["content-security-policy"] =
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
    set.headers["x-content-type-options"] = "nosniff";
    set.headers["x-frame-options"] = "DENY";
    set.headers["referrer-policy"] = "strict-origin-when-cross-origin";
  })
  .get("/health", () => ({ status: "ok" }))
  .group("/api", (app) =>
    app
      .use(authPlugin)
      // 300 req/min per IP for read (GET) endpoints across the entire API
      .use(rateLimiterPlugin({ limit: 300, windowMs: 60_000, methods: ["GET", "HEAD"] }))
      .use(setupRouter)
      .use(authRouter)
      .use(snapshotsRouter)
      .use(snapshotTagsRouter)
      .use(schedulesRouter)
      .use(tagsRouter)
      .use(importRouter)
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

if (import.meta.main) {
  app.listen(PORT);
  logger.info({ port: PORT }, "@webfrost/server listening");
}
