import { homedir } from "node:os";
import { join } from "node:path";
import { openDb } from "@webfrost/core";
import { Elysia } from "elysia";

function getWebfrostDir(): string {
  return process.env.WEBFROST_DIR ?? join(homedir(), ".webfrost");
}

function getDb() {
  return openDb(getWebfrostDir());
}

export const settingsRouter = new Elysia({ prefix: "/settings" }).get("/info", () => {
  const webfrostDir = getWebfrostDir();
  const db = getDb();
  try {
    const row = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM snapshots").get();
    return {
      version: "0.0.0",
      storagePath: webfrostDir,
      snapshotCount: row?.count ?? 0,
    };
  } finally {
    db.close();
  }
});
