import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
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

function postBundle(body: BodyInit, headers: Record<string, string> = {}) {
  return import("../index").then(({ app }) =>
    app.handle(
      new Request("http://localhost/api/v1/snapshots/import", {
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
