import { homedir } from "node:os";
import { join } from "node:path";
import { type Stats, getStats, openDb } from "@webfrost/core";
import { Elysia } from "elysia";

function getWebfrostDir(): string {
  return process.env.WEBFROST_DIR ?? join(homedir(), ".webfrost");
}

function getDb() {
  return openDb(getWebfrostDir());
}

// 60-second in-memory cache keyed by WEBFROST_DIR so tests with isolated dirs get fresh results
const cache = new Map<string, { stats: Stats; expiry: number }>();

export const statsRouter = new Elysia({ prefix: "/stats" }).get("/", () => {
  const dir = getWebfrostDir();
  const now = Date.now();
  const cached = cache.get(dir);
  if (cached && now < cached.expiry) {
    return cached.stats;
  }
  const db = getDb();
  try {
    const stats = getStats(db);
    cache.set(dir, { stats, expiry: now + 60_000 });
    return stats;
  } finally {
    db.close();
  }
});
