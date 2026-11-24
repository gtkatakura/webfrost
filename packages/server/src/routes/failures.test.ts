import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, sql } from "@webfrost/core";

let testDir: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `webfrost-failures-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  process.env.WEBFROST_DIR = testDir;
});

afterEach(async () => {
  const { closeDatabases } = await import("@webfrost/core");
  await closeDatabases();
  Reflect.deleteProperty(process.env, "WEBFROST_DIR");
  rmSync(testDir, { recursive: true, force: true });
});

async function getApp() {
  const { failuresRouter } = await import("./failures");
  const { trashRouter } = await import("./trash");
  const { settingsRouter } = await import("./settings");
  const { Elysia } = await import("elysia");
  return new Elysia().use(failuresRouter).use(trashRouter).use(settingsRouter);
}

async function withDb<T>(fn: (db: Awaited<ReturnType<typeof openDb>>) => Promise<T>): Promise<T> {
  const db = await openDb(testDir);
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

/** A snapshot as the pipeline leaves it, with a file of its own. */
async function seed(url: string, status: string, category: string | null = null): Promise<number> {
  const id = await withDb((db) =>
    db.insert(
      sql`INSERT INTO snapshots (url, status, failure_category, failure_detail)
          VALUES (${url}, ${status}, ${category}, ${category ? "getaddrinfo ENOTFOUND" : null})`,
    ),
  );
  mkdirSync(join(testDir, "snapshots", String(id)), { recursive: true });
  writeFileSync(join(testDir, "snapshots", String(id), "page.html"), "x");
  return id;
}

async function rows(): Promise<{ id: number; trashed: boolean }[]> {
  return withDb(async (db) =>
    (
      await db.all<{ id: number; trashed_at: string | null }>(
        sql`SELECT id, trashed_at FROM snapshots ORDER BY id`,
      )
    ).map((r) => ({ id: r.id, trashed: r.trashed_at !== null })),
  );
}

function post(app: Awaited<ReturnType<typeof getApp>>, path: string, body?: unknown) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

describe("GET /failures", () => {
  test("every group with its counts", async () => {
    await seed("http://gone.invalid/a", "failed", "domain_not_found");
    await seed("http://site.invalid/x", "failed", "page_not_found");
    await seed("http://ok.invalid/", "done");
    const app = await getApp();
    const body = await (await app.handle(new Request("http://localhost/failures"))).json();
    const counts = Object.fromEntries(
      body.groups.map((g: { id: string; count: number }) => [g.id, g.count]),
    );
    expect(counts["domain-gone"]).toBe(1);
    expect(counts["page-gone"]).toBe(1);
    expect(counts.blocked).toBe(0);
  });
});

describe("GET /failures/:group/domains", () => {
  test("paginated, filtered, and 404 for an unknown group", async () => {
    await seed("http://mangahost4.invalid/a", "failed", "domain_not_found");
    await seed("http://mangahost4.invalid/b", "failed", "domain_not_found");
    await seed("http://br.mangahost.invalid/c", "failed", "domain_not_found");
    await seed("http://other.invalid/d", "failed", "domain_not_found");
    const app = await getApp();

    const filtered = await (
      await app.handle(new Request("http://localhost/failures/domain-gone/domains?q=MangaHost"))
    ).json();
    expect(filtered.items.map((d: { host: string; count: number }) => [d.host, d.count])).toEqual([
      ["mangahost4.invalid", 2],
      ["br.mangahost.invalid", 1],
    ]);
    expect(filtered.snapshots).toBe(3);

    const page2 = await (
      await app.handle(new Request("http://localhost/failures/domain-gone/domains?limit=2&page=2"))
    ).json();
    expect(page2.total).toBe(3);
    expect(page2.items).toHaveLength(1);

    const unknown = await app.handle(new Request("http://localhost/failures/nope/domains"));
    expect(unknown.status).toBe(404);
  });
});

describe("POST /failures/:group/trash and /delete", () => {
  test("moving a domain to the trash touches its failed snapshots only, never one that worked", async () => {
    const a = await seed("http://gone.invalid/a", "failed", "domain_not_found");
    const worked = await seed("http://gone.invalid/a", "done");
    const otherReason = await seed("http://gone.invalid/b", "failed", "timeout");
    const app = await getApp();

    const res = await post(app, "/failures/domain-gone/trash", { hosts: ["GONE.invalid"] });
    expect(await res.json()).toEqual({ trashed: 1 });
    expect(await rows()).toEqual([
      { id: a, trashed: true },
      { id: worked, trashed: false },
      { id: otherReason, trashed: false },
    ]);
  });

  test("ids outside the group are ignored, so a stale page cannot delete the wrong snapshot", async () => {
    const failed = await seed("http://gone.invalid/a", "failed", "domain_not_found");
    const done = await seed("http://gone.invalid/b", "done");
    const app = await getApp();

    const res = await post(app, "/failures/domain-gone/delete", { ids: [failed, done] });
    expect(await res.json()).toEqual({ deleted: 1, busy: 0 });
    expect((await rows()).map((r) => r.id)).toEqual([done]);
    expect(existsSync(join(testDir, "snapshots", String(failed), "page.html"))).toBe(false);
  });
});

describe("select all", () => {
  test("all, narrowed by the filter, less what was unticked; no ids needed", async () => {
    const m1 = await seed("http://m1.mangahost.invalid/a", "failed", "domain_not_found");
    const m2 = await seed("http://m2.mangahost.invalid/a", "failed", "domain_not_found");
    const m2b = await seed("http://m2.mangahost.invalid/b", "failed", "domain_not_found");
    const m3 = await seed("http://m3.mangahost.invalid/a", "failed", "domain_not_found");
    const other = await seed("http://other.invalid/", "failed", "domain_not_found");
    const app = await getApp();

    const res = await post(app, "/failures/domain-gone/trash", {
      all: true,
      q: "mangahost",
      excludeHosts: ["m3.mangahost.invalid"],
      excludeIds: [m2b],
    });
    expect(await res.json()).toEqual({ trashed: 2 });
    expect(await rows()).toEqual([
      { id: m1, trashed: true },
      { id: m2, trashed: true },
      { id: m2b, trashed: false },
      { id: m3, trashed: false },
      { id: other, trashed: false },
    ]);
  });

  test("all of one domain's page", async () => {
    const a = await seed("http://gone.invalid/a", "failed", "domain_not_found");
    const b = await seed("http://gone.invalid/b", "failed", "domain_not_found");
    const elsewhere = await seed("http://else.invalid/", "failed", "domain_not_found");
    const app = await getApp();
    await post(app, "/failures/domain-gone/trash", {
      all: true,
      host: "gone.invalid",
      excludeIds: [b],
    });
    expect(await rows()).toEqual([
      { id: a, trashed: true },
      { id: b, trashed: false },
      { id: elsewhere, trashed: false },
    ]);
  });

  test("the trash: restore all but one", async () => {
    const a = await seed("http://a.invalid/", "failed", "timeout");
    const b = await seed("http://b.invalid/", "failed", "timeout");
    const app = await getApp();
    await post(app, "/failures/temporary/trash", { ids: [a, b] });
    expect(
      await (await post(app, "/trash/restore", { all: true, excludeIds: [b] })).json(),
    ).toEqual({
      restored: 1,
    });
    expect(await rows()).toEqual([
      { id: a, trashed: false },
      { id: b, trashed: true },
    ]);
  });
});

describe("POST /failures/domain-gone/retry", () => {
  test("a domain still gone keeps its snapshots failed and is reported", async () => {
    const host = `still-gone-${Math.random().toString(36).slice(2, 8)}.invalid`;
    const id = await seed(`http://${host}/`, "failed", "domain_not_found");
    const app = await getApp();

    const res = await post(app, "/failures/domain-gone/retry", { hosts: [host] });
    expect(await res.json()).toEqual({ queued: 0, stillGone: [host] });
    const status = await withDb(
      async (db) =>
        (await db.get<{ status: string }>(sql`SELECT status FROM snapshots WHERE id = ${id}`))
          ?.status,
    );
    expect(status).toBe("failed");
  });
});

describe("trash routes", () => {
  test("list, restore, delete for good and empty", async () => {
    const a = await seed("http://a.invalid/", "failed", "timeout");
    const b = await seed("http://b.invalid/", "failed", "timeout");
    const c = await seed("http://c.invalid/", "failed", "timeout");
    const app = await getApp();
    await post(app, "/failures/temporary/trash", { ids: [a, b, c] });

    const list = await (await app.handle(new Request("http://localhost/trash"))).json();
    expect(list.total).toBe(3);
    expect(list.retentionDays).toBe(30);
    expect(list.items[0].deleteAfter).toMatch(/Z$/);

    expect(await (await post(app, "/trash/restore", { ids: [a] })).json()).toEqual({ restored: 1 });
    expect(await (await post(app, "/trash/delete", { ids: [b] })).json()).toEqual({
      deleted: 1,
      busy: 0,
    });
    expect(await (await post(app, "/trash/empty")).json()).toEqual({ deleted: 1, busy: 0 });
    expect(await rows()).toEqual([{ id: a, trashed: false }]);
  });

  test("delete from the trash refuses snapshots that are not in it", async () => {
    const a = await seed("http://a.invalid/", "done");
    const app = await getApp();
    expect(await (await post(app, "/trash/delete", { ids: [a] })).json()).toEqual({
      deleted: 0,
      busy: 0,
    });
    expect((await rows()).map((r) => r.id)).toEqual([a]);
  });
});

describe("/settings/general", () => {
  test("the trash retention is read, changed and validated", async () => {
    const app = await getApp();
    const patch = (body: unknown) =>
      app.handle(
        new Request("http://localhost/settings/general", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    expect(
      (await (await app.handle(new Request("http://localhost/settings/general"))).json())
        .trashRetentionDays,
    ).toBe(30);
    expect((await (await patch({ trashRetentionDays: 7 })).json()).trashRetentionDays).toBe(7);
    expect((await patch({ trashRetentionDays: 0 })).status).toBe(400);
    expect(
      (await (await app.handle(new Request("http://localhost/settings/general"))).json())
        .trashRetentionDays,
    ).toBe(7);
  });
});
