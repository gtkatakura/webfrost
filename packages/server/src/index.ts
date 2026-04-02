import { staticPlugin } from "@elysiajs/static";
import { Elysia } from "elysia";
import { schedulesRouter } from "./routes/schedules";
import { snapshotsRouter } from "./routes/snapshots";

const PORT = Number(process.env.PORT ?? "3000");

export const app = new Elysia()
  .use(staticPlugin({ assets: "public", prefix: "/" }))
  .get("/health", () => ({ status: "ok" }))
  .group("/api", (app) => app.use(snapshotsRouter).use(schedulesRouter));

if (import.meta.main) {
  app.listen(PORT);
  console.log(`@webfrost/server listening on port ${PORT}`);
}
