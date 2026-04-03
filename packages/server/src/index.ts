import { staticPlugin } from "@elysiajs/static";
import { Elysia } from "elysia";
import { schedulesRouter } from "./routes/schedules";
import { snapshotsRouter } from "./routes/snapshots";
import { snapshotTagsRouter, tagsRouter } from "./routes/tags";

const PORT = Number(process.env.PORT ?? "3000");

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
    app.use(snapshotsRouter).use(snapshotTagsRouter).use(schedulesRouter).use(tagsRouter),
  );

if (import.meta.main) {
  app.listen(PORT);
  console.log(`@webfrost/server listening on port ${PORT}`);
}
