import { staticPlugin } from "@elysiajs/static";
import { Elysia } from "elysia";
import { rateLimiterPlugin } from "./middleware/rateLimiter";
import { authPlugin, authRouter } from "./routes/auth";
import { importRouter } from "./routes/import";
import { schedulesRouter } from "./routes/schedules";
import { setupRouter } from "./routes/setup";
import { snapshotsRouter } from "./routes/snapshots";
import { snapshotTagsRouter, tagsRouter } from "./routes/tags";

const PORT = Number(process.env.PORT ?? "3000");

// Refuse to start if auth is enabled but SESSION_SECRET is not configured
if (process.env.AUTH_DISABLED !== "true" && !process.env.SESSION_SECRET) {
  console.error(
    "[server] SESSION_SECRET env var is required. Set it to a random string of at least 32 characters, or set AUTH_DISABLED=true for development.",
  );
  process.exit(1);
}

export const app = new Elysia()
  .onAfterHandle(({ set }) => {
    set.headers["content-security-policy"] =
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
    set.headers["x-content-type-options"] = "nosniff";
    set.headers["x-frame-options"] = "DENY";
    set.headers["referrer-policy"] = "strict-origin-when-cross-origin";
  })
  .use(staticPlugin({ assets: "public", prefix: "/" }))
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
      .use(importRouter),
  );

if (import.meta.main) {
  app.listen(PORT);
  console.log(`@webfrost/server listening on port ${PORT}`);
}
