import { Elysia } from "elysia";
import { snapshotsRouter } from "./routes/snapshots";

const PORT = Number(process.env.PORT ?? "3000");

export const app = new Elysia().get("/health", () => ({ status: "ok" })).use(snapshotsRouter);

if (import.meta.main) {
  app.listen(PORT);
  console.log(`@webfrost/server listening on port ${PORT}`);
}
