import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FilesystemBackend,
  addTagToSnapshot,
  closeDatabases,
  createApiKey,
  createTag,
  exportSnapshotBundle,
  openDb,
  recordResult,
  searchSnapshots,
  sql,
} from "@webfrost/core";
import { zipSync } from "fflate";

let root: string;
let serverDir: string;
let authHeader: Record<string, string>;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "webfrost-bundle-import-test-"));
  serverDir = join(root, "server");
  mkdirSync(serverDir);
  process.env.WEBFROST_DIR = serverDir;
  const db = await openDb(serverDir);
  try {
    const { rawKey } = await createApiKey(db, "push-test");
    authHeader = { authorization: `Bearer ${rawKey}` };
  } finally {
    await db.close();
  }
});

afterEach(async () => {
  await closeDatabases();
  Reflect.deleteProperty(process.env, "WEBFROST_DIR");
  Reflect.deleteProperty(process.env, "WEBFROST_IMPORT_BUNDLE_MAX_BYTES");
  rmSync(root, { recursive: true, force: true });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);

/** A done snapshot in a separate "laptop" archive, exported as a bundle. */
async function laptopBundle(): Promise<Blob> {
  const dir = join(root, "laptop");
  mkdirSync(dir);
  const db = await openDb(dir);
  const storage = new FilesystemBackend(join(dir, "snapshots"));
  try {
    const id = await db.insert(
      sql`INSERT INTO snapshots (url, status, created_at) VALUES ('https://video.example/watch', 'done', '2026-05-06 07:08:09')`,
    );
    await recordResult(db, id, {
      extractor: "readability",
      content: JSON.stringify({ title: "Platypus", textContent: "the platypus lays eggs" }),
    });
    const ref = await storage.putBytes(id, "screenshot.png", PNG);
    await recordResult(db, id, { extractor: "screenshot", content: ref, sizeBytes: PNG.length });
    const tag = await createTag(db, "Videos");
    await addTagToSnapshot(db, id, tag.id);
    const path = join(root, "bundle.zip");
    await exportSnapshotBundle(db, storage, id, path);
    return new Blob([await Bun.file(path).arrayBuffer()]);
  } finally {
    await db.close();
  }
}

function postBundle(body: BodyInit, headers: Record<string, string> = {}, query = "") {
  return import("../index").then(({ app }) =>
    app.handle(
      new Request(`http://localhost/api/v1/snapshots/import${query}`, {
        method: "POST",
        headers: { "content-type": "application/zip", ...authHeader, ...headers },
        body,
      }),
    ),
  );
}

async function snapshotCount(): Promise<number> {
  const db = await openDb(serverDir);
  try {
    return Number((await db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM snapshots`))?.n);
  } finally {
    await db.close();
  }
}

describe("POST /api/v1/snapshots/import", () => {
  test("201 with a new snapshot: results, file, tags and search index in the server's archive", async () => {
    const bundle = await laptopBundle();
    const res = await postBundle(bundle);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: number; url: string; status: string };
    expect(body).toEqual({
      id: expect.any(Number),
      url: "https://video.example/watch",
      status: "done",
    });

    const db = await openDb(serverDir);
    try {
      const snap = await db.get<{ status: string; created_at: string }>(
        sql`SELECT status, created_at FROM snapshots WHERE id = ${body.id}`,
      );
      expect(snap).toEqual({ status: "done", created_at: "2026-05-06 07:08:09" });
      const shot = await db.get<{ content: string }>(
        sql`SELECT content FROM archive_results WHERE snapshot_id = ${body.id} AND extractor = 'screenshot'`,
      );
      expect(shot?.content).toBe(join(serverDir, "snapshots", String(body.id), "screenshot.png"));
      expect(Array.from(await Bun.file(shot?.content as string).bytes())).toEqual(Array.from(PNG));
      const tags = await db.all<{ name: string }>(
        sql`SELECT t.name FROM tags t JOIN snapshot_tags st ON st.tag_id = t.id WHERE st.snapshot_id = ${body.id}`,
      );
      expect(tags.map((t) => t.name)).toEqual(["Videos"]);
      expect((await searchSnapshots(db, "platypus")).items.map((h) => h.id)).toEqual([body.id]);
    } finally {
      await db.close();
    }

    // Served like any other snapshot: the file with the type the server derives from the extractor.
    const { app } = await import("../index");
    const download = await app.handle(
      new Request(`http://localhost/api/v1/snapshots/${body.id}/archives/screenshot/download`, {
        headers: authHeader,
      }),
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("image/png");
    // The spooled upload is gone.
    expect(readdirSync(join(serverDir, "tmp"))).toEqual([]);
  });

  test("a hostile bundle is a 400 and leaves nothing behind", async () => {
    const manifest = {
      format: "webfrost-snapshot",
      version: 1,
      snapshot: {
        url: "https://x.example/",
        status: "done",
        createdAt: "2026-01-01T00:00:00Z",
        colorScheme: null,
        tags: [],
      },
      results: [],
    };
    const bundle = zipSync({
      "manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
      "../../../etc/cron.d/evil": new TextEncoder().encode("* * * * * root sh"),
    });
    const res = await postBundle(bundle);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("VALIDATION");
    expect(body.error).toMatch(/not referenced/);
    expect(await snapshotCount()).toBe(0);
    expect(existsSync(join(serverDir, "snapshots"))).toBe(false);
    expect(readdirSync(join(serverDir, "tmp"))).toEqual([]);
  });

  test("Readability JSON with an object title is a 400 (not a 500 from indexing), nothing stored", async () => {
    const manifest = {
      format: "webfrost-snapshot",
      version: 1,
      snapshot: {
        url: "https://x.example/",
        status: "done",
        createdAt: "2026-01-01T00:00:00Z",
        colorScheme: null,
        tags: [],
      },
      results: [
        {
          extractor: "readability",
          content: JSON.stringify({ title: { a: 1 }, textContent: "x" }),
          error: null,
          durationMs: 1,
          sizeBytes: 1,
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    };
    const bundle = zipSync({ "manifest.json": new TextEncoder().encode(JSON.stringify(manifest)) });
    const res = await postBundle(bundle);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/title must be a string/);
    expect(await snapshotCount()).toBe(0);
  });

  test("anything but application/zip is a 415", async () => {
    const res = await postBundle("{}", { "content-type": "application/json" });
    expect(res.status).toBe(415);
    expect(await snapshotCount()).toBe(0);
  });

  test("a body over WEBFROST_IMPORT_BUNDLE_MAX_BYTES is a 413, declared or not", async () => {
    process.env.WEBFROST_IMPORT_BUNDLE_MAX_BYTES = "1000";
    const declared = await postBundle(new Uint8Array(2000), { "content-length": "2000" });
    expect(declared.status).toBe(413);
    // No Content-Length: refused while streaming, once the count passes the limit.
    const streamed = await postBundle(new Blob([new Uint8Array(2000)]).stream());
    expect(streamed.status).toBe(413);
    expect(((await streamed.json()) as { code: string }).code).toBe("PAYLOAD_TOO_LARGE");
    expect(await snapshotCount()).toBe(0);
    expect(readdirSync(join(serverDir, "tmp"))).toEqual([]);
  });

  test("counts against the snapshot-creation rate limit: the 61st POST in a minute is refused", async () => {
    process.env.WEBFROST_TRUST_PROXY = "true";
    try {
      const junk = () =>
        postBundle("not a zip file, just text", { "x-forwarded-for": "203.0.113.91" });
      for (let i = 0; i < 60; i++) expect((await junk()).status).toBe(400);
      const blocked = await junk();
      expect(blocked.status).toBe(429);
    } finally {
      Reflect.deleteProperty(process.env, "WEBFROST_TRUST_PROXY");
    }
  });
});

describe("POST /snapshots/import?replaces=<id> (webfrost rescue)", () => {
  async function seedFailure(url: string, status = "failed"): Promise<number> {
    const db = await openDb(serverDir);
    try {
      return await db.insert(
        sql`INSERT INTO snapshots (url, status, failure_category) VALUES (${url}, ${status}, 'access_denied')`,
      );
    } finally {
      await db.close();
    }
  }

  async function state(id: number) {
    const db = await openDb(serverDir);
    try {
      return await db.get<{ status: string; trashed: number }>(
        sql`SELECT status, CASE WHEN trashed_at IS NULL THEN 0 ELSE 1 END AS trashed FROM snapshots WHERE id = ${id}`,
      );
    } finally {
      await db.close();
    }
  }

  test("201: the copy is stored and the failure moves to the trash; again is a 409", async () => {
    const failed = await seedFailure("https://video.example/watch");
    const bundle = await laptopBundle();
    const res = await postBundle(bundle, {}, `?replaces=${failed}`);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: number; replaced: number };
    expect(body.replaced).toBe(failed);
    expect(await state(failed)).toEqual({ status: "failed", trashed: 1 });
    expect(await state(body.id)).toEqual({ status: "done", trashed: 0 });

    const again = await postBundle(bundle, {}, `?replaces=${failed}`);
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toContain("in the trash");
    expect(await snapshotCount()).toBe(2);
  });

  test("a failure of another URL is a 409 and nothing is stored", async () => {
    const failed = await seedFailure("https://video.example/other");
    const res = await postBundle(await laptopBundle(), {}, `?replaces=${failed}`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("another URL");
    expect(await snapshotCount()).toBe(1);
    expect(await state(failed)).toEqual({ status: "failed", trashed: 0 });
    const stored = join(serverDir, "snapshots");
    expect(existsSync(stored) ? readdirSync(stored) : []).toEqual([]);
  });

  test("a snapshot that is not failed is refused before the upload is read; a bad id is a 400", async () => {
    const done = await seedFailure("https://video.example/watch", "done");
    const bundle = await laptopBundle();
    const res = await postBundle(bundle, {}, `?replaces=${done}`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("is done, not failed");
    expect(await snapshotCount()).toBe(1);
    for (const bad of ["0", "abc", "-1", "1e3"]) {
      expect((await postBundle(bundle, {}, `?replaces=${bad}`)).status).toBe(400);
    }
  });
});

describe("POST /snapshots/import — authentication", () => {
  test("401 without credentials, and nothing is stored", async () => {
    process.env.SESSION_SECRET = "test-secret-32-chars-long-enough!!";
    const previous = process.env.AUTH_DISABLED;
    Reflect.deleteProperty(process.env, "AUTH_DISABLED");
    try {
      const { authPlugin } = await import("./auth");
      const { snapshotImportRouter } = await import("./snapshot-import");
      const { Elysia } = await import("elysia");
      const app = new Elysia().use(authPlugin).use(snapshotImportRouter);
      const bundle = await laptopBundle();
      const res = await app.handle(
        new Request("http://localhost/snapshots/import", {
          method: "POST",
          headers: { "content-type": "application/zip" },
          body: bundle,
        }),
      );
      expect(res.status).toBe(401);
      const withKey = await app.handle(
        new Request("http://localhost/snapshots/import", {
          method: "POST",
          headers: { "content-type": "application/zip", ...authHeader },
          body: bundle,
        }),
      );
      expect(withKey.status).toBe(201);
      expect(await snapshotCount()).toBe(1);
    } finally {
      Reflect.deleteProperty(process.env, "SESSION_SECRET");
      if (previous !== undefined) process.env.AUTH_DISABLED = previous;
    }
  });
});

describe("bundle import limits and crash recovery", () => {
  test("at most two imports run at once; a third is a 429 with Retry-After", async () => {
    const { activeBundleImports } = await import("./snapshot-import");
    // Two uploads that stay open until released.
    const releases: (() => void)[] = [];
    const held = [0, 1].map(() => {
      let release = () => {};
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([0x50, 0x4b]));
          release = () => controller.close();
        },
      });
      const pending = postBundle(body);
      releases.push(() => release());
      return pending;
    });
    for (let i = 0; i < 50 && activeBundleImports() < 2; i++) await Bun.sleep(10);
    expect(activeBundleImports()).toBe(2);

    const bundle = await laptopBundle();
    const third = await postBundle(bundle);
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBe("30");
    expect(await snapshotCount()).toBe(0);

    for (const release of releases) release();
    for (const res of await Promise.all(held)) expect(res.status).toBe(400);
    expect(activeBundleImports()).toBe(0);
    expect((await postBundle(bundle)).status).toBe(201);
  });

  test("a listening server gives the upload a finite idle timeout, lifted once the body is in", async () => {
    const { app } = await import("../index");
    const { BUNDLE_IMPORT_IDLE_TIMEOUT_SECONDS } = await import("./snapshot-import");
    app.listen({ port: 0, hostname: "127.0.0.1" });
    try {
      const server = app.server as NonNullable<typeof app.server>;
      const calls: number[] = [];
      const original = server.timeout.bind(server);
      server.timeout = (req: Request, seconds: number) => {
        calls.push(seconds);
        return original(req, seconds);
      };
      const res = await fetch(`http://127.0.0.1:${server.port}/api/v1/snapshots/import`, {
        method: "POST",
        headers: { "content-type": "application/zip", ...authHeader },
        body: "not a zip, long enough to have no end record",
      });
      expect(res.status).toBe(400);
      // Finite while the upload streams in (Bun's maximum), lifted once the body is complete.
      expect(calls).toEqual([BUNDLE_IMPORT_IDLE_TIMEOUT_SECONDS, 0]);
      expect(BUNDLE_IMPORT_IDLE_TIMEOUT_SECONDS).toBeGreaterThan(0);
      expect(BUNDLE_IMPORT_IDLE_TIMEOUT_SECONDS).toBeLessThanOrEqual(255);
    } finally {
      await app.stop();
    }
  });

  test("a snapshot still importing is hidden, and delete or retry answer 409", async () => {
    const db = await openDb(serverDir);
    const id = await db.insert(
      sql`INSERT INTO snapshots (url, status) VALUES ('https://x.example/', 'importing')`,
    );
    await db.close();
    const { app } = await import("../index");
    const call = (method: string, path: string) =>
      app.handle(
        new Request(`http://localhost/api/v1/snapshots${path}`, { method, headers: authHeader }),
      );
    expect((await call("GET", `/${id}`)).status).toBe(404);
    const list = (await (await call("GET", "")).json()) as { total: number };
    expect(list.total).toBe(0);
    expect((await call("DELETE", `/${id}`)).status).toBe(409);
    expect((await call("POST", `/${id}/retry`)).status).toBe(409);
    expect(await snapshotCount()).toBe(1);
  });

  test("startup removes stale spool folders and imports a crash left behind, only when old", async () => {
    const { sweepInterruptedImports } = await import("../index");
    const tmp = join(serverDir, "tmp");
    const stale = join(tmp, `bundle-${crypto.randomUUID()}`);
    const fresh = join(tmp, `bundle-${crypto.randomUUID()}`);
    mkdirSync(stale, { recursive: true });
    mkdirSync(fresh, { recursive: true });
    const old = new Date(Date.now() - 2 * 3600 * 1000);
    utimesSync(stale, old, old);

    const db = await openDb(serverDir);
    const insert = async (ago: number) => {
      const id = await db.insert(
        sql`INSERT INTO snapshots (url, status) VALUES ('https://x.example/', 'importing')`,
      );
      await db.run(
        sql`INSERT INTO job_queue (snapshot_id, status, created_at) VALUES (${id}, 'importing', ${db.ago(ago)})`,
      );
      return id;
    };
    await insert(2 * 3600);
    const recent = await insert(10);
    await db.close();

    await sweepInterruptedImports(serverDir);
    expect(readdirSync(tmp)).toEqual([fresh.split("/").pop() as string]);
    const check = await openDb(serverDir);
    try {
      const rows = await check.all<{ id: number }>(sql`SELECT id FROM snapshots`);
      expect(rows.map((r) => Number(r.id))).toEqual([recent]);
    } finally {
      await check.close();
    }
  });

  test("a running server sweeps again later, not only at startup", async () => {
    const { startBackgroundWork } = await import("../index");
    const tmp = join(serverDir, "tmp");
    mkdirSync(tmp, { recursive: true });
    const saved = process.env.WEBFROST_SCHEDULER;
    process.env.WEBFROST_SCHEDULER = "false";
    const background = startBackgroundWork({ importSweepMs: 25 });
    try {
      // Left behind after startup: only a periodic sweep can remove it.
      const stale = join(tmp, `bundle-${crypto.randomUUID()}`);
      mkdirSync(stale);
      const old = new Date(Date.now() - 2 * 3600 * 1000);
      utimesSync(stale, old, old);
      for (let i = 0; i < 100 && existsSync(stale); i++) await Bun.sleep(25);
      expect(existsSync(stale)).toBe(false);
    } finally {
      background.stop();
      if (saved === undefined) Reflect.deleteProperty(process.env, "WEBFROST_SCHEDULER");
      else process.env.WEBFROST_SCHEDULER = saved;
    }
  });
});

// SQLite only: the database is broken through its file. On PostgreSQL or MySQL (CI) the test server
// stays reachable; the spool cleanup under test does not depend on the dialect.
describe.skipIf(Boolean(process.env.WEBFROST_TEST_DATABASE_URL?.trim()))(
  "POST /snapshots/import when the database cannot be opened",
  () => {
    test("the uploaded bundle is removed anyway", async () => {
      // A data folder where the database cannot be opened: archive.db is a folder.
      const broken = join(root, "broken");
      mkdirSync(join(broken, "archive.db"), { recursive: true });
      process.env.WEBFROST_DIR = broken;
      const { snapshotImportRouter } = await import("./snapshot-import");
      const { Elysia } = await import("elysia");
      const res = await new Elysia().use(snapshotImportRouter).handle(
        new Request("http://localhost/snapshots/import", {
          method: "POST",
          headers: { "content-type": "application/zip" },
          body: await laptopBundle(),
        }),
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
      const tmp = join(broken, "tmp");
      expect(
        existsSync(tmp) ? readdirSync(tmp).filter((n) => n.startsWith("bundle-")) : [],
      ).toEqual([]);
    });
  },
);
