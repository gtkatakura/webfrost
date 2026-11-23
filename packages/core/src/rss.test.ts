import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { openDb } from "./db";
import { ImportLimitError } from "./import";
import { fetchRssFeedUrls, isUrlArchived } from "./rss";
import { addRssFeedSchedule, addSchedule, listSchedules } from "./schedules";

let testDir: string;

afterEach(() => {
  if (testDir) {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

async function makeDb() {
  testDir = mkdtempSync(join(tmpdir(), "rss-test-"));
  return openDb(testDir);
}

describe("isUrlArchived", () => {
  test("returns false when no snapshots exist", async () => {
    const db = await makeDb();
    expect(await isUrlArchived(db, "https://example.com")).toBe(false);
    await db.close();
  });

  test("returns true when the exact URL is archived", async () => {
    const db = await makeDb();
    await db.run(sql`INSERT INTO snapshots (url, status) VALUES ('https://example.com', 'done')`);
    expect(await isUrlArchived(db, "https://example.com")).toBe(true);
    await db.close();
  });

  test("returns false for a different URL", async () => {
    const db = await makeDb();
    await db.run(sql`INSERT INTO snapshots (url, status) VALUES ('https://example.com', 'done')`);
    expect(await isUrlArchived(db, "https://other.com")).toBe(false);
    await db.close();
  });
});

describe("addRssFeedSchedule", () => {
  test("creates a schedule with kind=rss_feed", async () => {
    const db = await makeDb();
    const id = await addRssFeedSchedule(db, "https://example.com/feed.rss", "0 * * * *");
    const schedules = await listSchedules(db);
    const s = schedules.find((x) => x.id === id);
    expect(s).toBeDefined();
    expect(s?.kind).toBe("rss_feed");
    expect(s?.url).toBe("https://example.com/feed.rss");
    await db.close();
  });

  test("addSchedule defaults to kind=url", async () => {
    const db = await makeDb();
    const id = await addSchedule(db, "https://example.com", "0 * * * *");
    const schedules = await listSchedules(db);
    const s = schedules.find((x) => x.id === id);
    expect(s?.kind).toBe("url");
    await db.close();
  });

  test("can mix url and rss_feed schedules in same table", async () => {
    const db = await makeDb();
    await addSchedule(db, "https://example.com", "0 * * * *");
    await addRssFeedSchedule(db, "https://example.com/feed.rss", "0 * * * *");
    const schedules = await listSchedules(db);
    expect(schedules.some((s) => s.kind === "url")).toBe(true);
    expect(schedules.some((s) => s.kind === "rss_feed")).toBe(true);
    await db.close();
  });
});

describe("fetchRssFeedUrls", () => {
  let server: ReturnType<typeof Bun.serve>;
  let base: string;
  const saved: Record<string, string | undefined> = {};
  const ENV = [
    "WEBFROST_ALLOW_PRIVATE_URLS",
    "WEBFROST_IMPORT_MAX_BYTES",
    "WEBFROST_IMPORT_MAX_URLS",
  ];

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === "/old") return Response.redirect(`${base}/blog/feed.xml`, 302);
        if (pathname === "/blog/feed.xml") {
          return new Response(
            '<feed xmlns="http://www.w3.org/2005/Atom"><entry><link href="post-1"/></entry></feed>',
          );
        }
        if (pathname === "/big") {
          const item = "<item><link>https://x.example/1</link></item>";
          return new Response(`<rss>${item.repeat(50)}</rss>`);
        }
        if (pathname === "/many") {
          const items = [1, 2, 3, 4].map((i) => `<item><link>https://x.example/${i}</link></item>`);
          return new Response(`<rss>${items.join("")}</rss>`);
        }
        return new Response("nope", { status: 404 });
      },
    });
    base = `http://127.0.0.1:${server.port}`;
    for (const k of ENV) saved[k] = process.env[k];
    process.env.WEBFROST_ALLOW_PRIVATE_URLS = "true";
  });

  afterAll(() => {
    server.stop(true);
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  afterEach(() => {
    Reflect.deleteProperty(process.env, "WEBFROST_IMPORT_MAX_BYTES");
    Reflect.deleteProperty(process.env, "WEBFROST_IMPORT_MAX_URLS");
  });

  test("relative links resolve against the URL after redirects", async () => {
    expect(await fetchRssFeedUrls(`${base}/old`)).toEqual([`${base}/blog/post-1`]);
  });

  test("a feed over WEBFROST_IMPORT_MAX_BYTES is refused", async () => {
    process.env.WEBFROST_IMPORT_MAX_BYTES = "100";
    const err = await fetchRssFeedUrls(`${base}/big`).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImportLimitError);
    expect((err as ImportLimitError).limit).toBe("bytes");
  });

  test("a feed with more links than WEBFROST_IMPORT_MAX_URLS is refused", async () => {
    process.env.WEBFROST_IMPORT_MAX_URLS = "3";
    const err = await fetchRssFeedUrls(`${base}/many`).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImportLimitError);
    expect((err as ImportLimitError).limit).toBe("urls");
    process.env.WEBFROST_IMPORT_MAX_URLS = "4";
    expect(await fetchRssFeedUrls(`${base}/many`)).toHaveLength(4);
  });
});
