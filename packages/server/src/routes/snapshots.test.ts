import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "@webfrost/core";

let testDir: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `webfrost-server-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  process.env.WEBFROST_DIR = testDir;
});

afterEach(async () => {
  // Each test archive is its own database; release the pools so a server-backed run does not pile up connections.
  const { closeDatabases } = await import("@webfrost/core");
  await closeDatabases();
  Reflect.deleteProperty(process.env, "WEBFROST_DIR");
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

async function getApp() {
  const { snapshotsRouter } = await import("./snapshots");
  const { Elysia } = await import("elysia");
  return new Elysia().use(snapshotsRouter);
}

// ---------------------------------------------------------------------------
// POST /snapshots
// ---------------------------------------------------------------------------

describe("POST /snapshots", () => {
  test("returns 400 for missing url field", async () => {
    const app = await getApp();
    const res = await app.handle(
      new Request("http://localhost/snapshots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  test("returns 400 for non-HTTP/HTTPS URL", async () => {
    const app = await getApp();
    const res = await app.handle(
      new Request("http://localhost/snapshots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "ftp://example.com/file" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body).toEqual({ error: "invalid url", code: "VALIDATION" });
  });

  test("returns 202 with id/url/status for valid URL (fire and forget)", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response("<html><body>ok</body></html>", {
          headers: { "content-type": "text/html" },
        }),
    });
    const url = `http://localhost:${server.port}/page`;

    try {
      const { openDb } = await import("@webfrost/core");
      await (await openDb(testDir)).close();

      const app = await getApp();
      const res = await app.handle(
        new Request("http://localhost/snapshots", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
        }),
      );
      expect(res.status).toBe(202);
      const body = (await res.json()) as { id: number; url: string; status: string };
      expect(body.id).toBeGreaterThan(0);
      expect(body.url).toBe(url);
      expect(body.status).toBe("pending");
    } finally {
      server.stop(true);
    }
  });
});

describe("POST /snapshots: colorScheme", () => {
  const post = (app: Awaited<ReturnType<typeof getApp>>, body: unknown) =>
    app.handle(
      new Request("http://localhost/snapshots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  test("stores the requested scheme on the snapshot row", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response("<html><body>ok</body></html>", { headers: { "content-type": "text/html" } }),
    });
    const url = `http://localhost:${server.port}/page`;
    try {
      const { openDb } = await import("@webfrost/core");
      await (await openDb(testDir)).close();
      const app = await getApp();

      const dark = await post(app, { url, colorScheme: "dark" });
      expect(dark.status).toBe(202);
      const plain = await post(app, { url });
      expect(plain.status).toBe(202);
      const darkId = ((await dark.json()) as { id: number }).id;
      const plainId = ((await plain.json()) as { id: number }).id;

      const db = await openDb(testDir);
      try {
        const scheme = async (id: number) =>
          (
            await db.get<{ color_scheme: string | null }>(
              sql`SELECT color_scheme FROM snapshots WHERE id = ${id}`,
            )
          )?.color_scheme;
        expect(await scheme(darkId)).toBe("dark");
        expect(await scheme(plainId)).toBeNull();
      } finally {
        await db.close();
      }
    } finally {
      server.stop(true);
    }
  });

  test("rejects an unknown scheme and creates nothing", async () => {
    const { openDb } = await import("@webfrost/core");
    await (await openDb(testDir)).close();
    const app = await getApp();

    const res = await post(app, { url: "https://example.com", colorScheme: "blue" });
    expect(res.status).toBe(400);

    const db = await openDb(testDir);
    try {
      const n = await db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM snapshots`);
      expect(Number(n?.n)).toBe(0);
    } finally {
      await db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// GET /snapshots
// ---------------------------------------------------------------------------

interface SnapshotPage {
  items: Array<{
    id: number;
    url: string;
    status: string;
    createdAt: string;
    extractors: string[];
    tags: unknown[];
  }>;
  total: number;
  page: number;
  limit: number;
}

describe("GET /snapshots", () => {
  test("returns empty paginated result when no snapshots exist", async () => {
    const { openDb } = await import("@webfrost/core");
    await (await openDb(testDir)).close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/snapshots"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SnapshotPage;
    expect(body.items).toHaveLength(0);
    expect(body.total).toBe(0);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
  });

  test("returns snapshot list after adding a snapshot", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    await createSnapshot(db, "https://example.com");
    await db.close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/snapshots"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SnapshotPage;
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.items[0]?.url).toBe("https://example.com");
    expect(body.items[0]).toHaveProperty("id");
    expect(body.items[0]).toHaveProperty("status");
    expect(body.items[0]).toHaveProperty("createdAt");
    expect(Array.isArray(body.items[0]?.extractors)).toBe(true);
    expect(body.items[0]?.extractors).toHaveLength(0);
  });

  test("returns extractors list when archive results exist", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com/ext");
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (${id}, ${"readability"}, ${JSON.stringify({ title: "Test", textContent: "hello" })})`,
    );
    await db.close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/snapshots"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SnapshotPage;
    expect(body.items[0]?.extractors).toContain("readability");
  });

  test("paginates snapshot list with page and limit params", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    await createSnapshot(db, "https://first.com");
    await createSnapshot(db, "https://second.com");
    await createSnapshot(db, "https://third.com");
    await db.close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/snapshots?page=2&limit=1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SnapshotPage;
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(3);
    expect(body.page).toBe(2);
    expect(body.limit).toBe(1);
    expect(body.items[0]?.url).toBe("https://second.com");
  });

  test("returns title, excerpt, screenshotUrl when readability and screenshot extractors ran", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com/article");
    const snapshotsDir = join(testDir, "snapshots");
    mkdirSync(snapshotsDir, { recursive: true });
    const screenshotPath = join(snapshotsDir, `${id}-screenshot.png`);
    writeFileSync(screenshotPath, new Uint8Array([137, 80, 78, 71]));
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (${id}, ${"readability"}, ${JSON.stringify(
        {
          title: "Test Article",
          excerpt: "A short excerpt about something.",
          byline: null,
          textContent: null,
        },
      )})`,
    );
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (${id}, ${"screenshot"}, ${screenshotPath})`,
    );
    await db.close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/snapshots"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{
        id: number;
        title: string | null;
        excerpt: string | null;
        screenshotUrl: string | null;
      }>;
    };
    const item = body.items[0];
    expect(item?.title).toBe("Test Article");
    expect(item?.excerpt).toBe("A short excerpt about something.");
    expect(item?.screenshotUrl).toBe(`/api/v1/snapshots/${id}/archives/screenshot/download`);
  });

  test("screenshotUrl points at the thumbnail when there is one, else at the screenshot", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const both = await createSnapshot(db, "https://example.com/both");
    const only = await createSnapshot(db, "https://example.com/only-screenshot");
    for (const [id, extractor] of [
      [both, "screenshot"],
      [both, "thumbnail"],
      [only, "screenshot"],
    ] as const) {
      await db.run(
        sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (${id}, ${extractor}, ${`ref-${id}-${extractor}`})`,
      );
    }
    await db.close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/snapshots"));
    const body = (await res.json()) as {
      items: Array<{ id: number; screenshotUrl: string | null }>;
    };
    const url = (id: number) => body.items.find((i) => i.id === id)?.screenshotUrl;
    expect(url(both)).toBe(`/api/v1/snapshots/${both}/archives/thumbnail/download`);
    expect(url(only)).toBe(`/api/v1/snapshots/${only}/archives/screenshot/download`);
  });

  test("screenshotUrl prefers the video poster, then the thumbnail, then the screenshot", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const video = await createSnapshot(db, "https://example.com/video");
    for (const extractor of ["screenshot", "thumbnail", "media-poster"]) {
      await db.run(
        sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (${video}, ${extractor}, ${`ref-${video}-${extractor}`})`,
      );
    }
    await db.close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/snapshots"));
    const body = (await res.json()) as {
      items: Array<{ id: number; screenshotUrl: string | null }>;
    };
    expect(body.items.find((i) => i.id === video)?.screenshotUrl).toBe(
      `/api/v1/snapshots/${video}/archives/media-poster/download`,
    );
  });

  test("returns null title, excerpt, screenshotUrl when extractors did not run", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    await createSnapshot(db, "https://example.com/bare");
    await db.close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/snapshots"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ title: string | null; excerpt: string | null; screenshotUrl: string | null }>;
    };
    expect(body.items[0]?.title).toBeNull();
    expect(body.items[0]?.excerpt).toBeNull();
    expect(body.items[0]?.screenshotUrl).toBeNull();
  });

  test("truncates excerpt to 120 chars", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com/long");
    const longExcerpt = "x".repeat(200);
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (${id}, ${"readability"}, ${JSON.stringify({ title: "Long", excerpt: longExcerpt, byline: null, textContent: null })})`,
    );
    await db.close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/snapshots"));
    const body = (await res.json()) as { items: Array<{ excerpt: string | null }> };
    expect(body.items[0]?.excerpt?.length).toBe(120);
  });

  test("filters snapshots by status query param", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const pendingId = await createSnapshot(db, "https://pending.com");
    const doneId = await createSnapshot(db, "https://done.com");
    await db.run(sql`UPDATE snapshots SET status = 'done' WHERE id = ${doneId}`);
    await db.close();

    const app = await getApp();

    const pendingRes = await app.handle(new Request("http://localhost/snapshots?status=pending"));
    expect(pendingRes.status).toBe(200);
    const pendingBody = (await pendingRes.json()) as SnapshotPage;
    expect(pendingBody.items).toHaveLength(1);
    expect(pendingBody.items[0]?.id).toBe(pendingId);
    expect(pendingBody.total).toBe(1);

    const doneRes = await app.handle(new Request("http://localhost/snapshots?status=done"));
    expect(doneRes.status).toBe(200);
    const doneBody = (await doneRes.json()) as SnapshotPage;
    expect(doneBody.items).toHaveLength(1);
    expect(doneBody.items[0]?.id).toBe(doneId);
    expect(doneBody.total).toBe(1);
  });

  test("returns all snapshots when status param is omitted", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    await createSnapshot(db, "https://a.com");
    const id2 = await createSnapshot(db, "https://b.com");
    await db.run(sql`UPDATE snapshots SET status = 'done' WHERE id = ${id2}`);
    await db.close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/snapshots"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SnapshotPage;
    expect(body.items).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  test("returns empty when status filter matches no snapshots", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    await createSnapshot(db, "https://example.com");
    await db.close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/snapshots?status=done"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SnapshotPage;
    expect(body.items).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  test("returns empty items for out-of-range page", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    await createSnapshot(db, "https://example.com");
    await db.close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/snapshots?page=99&limit=20"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SnapshotPage;
    expect(body.items).toHaveLength(0);
    expect(body.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// GET /snapshots/:id/archives/:extractor/download
// ---------------------------------------------------------------------------

describe("GET /snapshots/:id/archives/:extractor/download", () => {
  test("returns 404 for non-existent snapshot", async () => {
    const { openDb } = await import("@webfrost/core");
    await (await openDb(testDir)).close();

    const app = await getApp();
    const res = await app.handle(
      new Request("http://localhost/snapshots/99999/archives/readability/download"),
    );
    expect(res.status).toBe(404);
  });

  test("returns 404 when extractor result has no content", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com");
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (${id}, 'readability', NULL)`,
    );
    await db.close();

    const app = await getApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots/${id}/archives/readability/download`),
    );
    expect(res.status).toBe(404);
  });

  test("returns readability JSON content for download", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com/read");
    const content = JSON.stringify({ title: "Hello", textContent: "World" });
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (${id}, ${"readability"}, ${content})`,
    );
    await db.close();

    const app = await getApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots/${id}/archives/readability/download`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-disposition")).toContain("readability.json");
    const body = await res.text();
    expect(body).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// GET /snapshots/:id/archives/:extractor/download — extractor allowlist + path sandbox
// ---------------------------------------------------------------------------

describe("GET /snapshots/:id/archives/:extractor/download — security", () => {
  test("returns 400 for unknown extractor", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com");
    await db.close();

    const app = await getApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots/${id}/archives/malicious/download`),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unknown extractor");
  });

  test("returns 403 when warc path escapes snapshots directory", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com");
    // Inject a path traversal value into the DB
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (${id}, ${"warc"}, ${"/etc/passwd"})`,
    );
    await db.close();

    const app = await getApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots/${id}/archives/warc/download`),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });

  test("returns 403 when pdf path escapes snapshots directory", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com");
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (${id}, ${"pdf"}, ${"/etc/shadow"})`,
    );
    await db.close();

    const app = await getApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots/${id}/archives/pdf/download`),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });

  test("returns 403 when screenshot path escapes snapshots directory", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com");
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (${id}, ${"screenshot"}, ${"/etc/passwd"})`,
    );
    await db.close();

    const app = await getApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots/${id}/archives/screenshot/download`),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });

  test("returns 403 when dom-snapshot path escapes snapshots directory", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com");
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (${id}, ${"dom-snapshot"}, ${"/etc/hosts"})`,
    );
    await db.close();

    const app = await getApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots/${id}/archives/dom-snapshot/download`),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });

  test("returns 403 when singlefile path escapes snapshots directory", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com");
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (${id}, ${"singlefile"}, ${"/etc/hostname"})`,
    );
    await db.close();

    const app = await getApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots/${id}/archives/singlefile/download`),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });
});

// ---------------------------------------------------------------------------
// GET /snapshots/:id/archives/:extractor/download — file-based extractors
// ---------------------------------------------------------------------------

describe("GET /snapshots/:id/archives/:extractor/download — streaming and metadata", () => {
  async function seed(extractor: string, name: string, content: string | Uint8Array) {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const { writeFileSync } = await import("node:fs");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com/stream");
    const dir = join(testDir, "snapshots");
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `${id}-${name}`);
    writeFileSync(filePath, content);
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (${id}, ${extractor}, ${filePath})`,
    );
    await db.close();
    return id;
  }

  test("serves a media file from a stream, with its length and attachment headers", async () => {
    const { FilesystemBackend } = await import("@webfrost/core");
    const bytes = new Uint8Array(4096).fill(7);
    const id = await seed("media", "media.mp4", bytes);
    let bufferedWhole = false;
    const orig = FilesystemBackend.prototype.getBytes;
    FilesystemBackend.prototype.getBytes = async function (...a: [string]) {
      bufferedWhole = true;
      return orig.apply(this, a);
    };
    try {
      const app = await getApp();
      const res = await app.handle(
        new Request(`http://localhost/snapshots/${id}/archives/media/download`),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("video/mp4");
      expect(res.headers.get("content-disposition")).toBe('attachment; filename="media.mp4"');
      expect(res.headers.get("content-length")).toBe("4096");
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
      expect(bufferedWhole).toBe(false);
    } finally {
      FilesystemBackend.prototype.getBytes = orig;
    }
  });

  test("the preview is streamed too and keeps its CSP", async () => {
    const { FilesystemBackend } = await import("@webfrost/core");
    const id = await seed("singlefile", "singlefile.html", "<p>hello</p>");
    let bufferedWhole = false;
    const orig = FilesystemBackend.prototype.getBytes;
    FilesystemBackend.prototype.getBytes = async function (...a: [string]) {
      bufferedWhole = true;
      return orig.apply(this, a);
    };
    try {
      const app = await getApp();
      const res = await app.handle(
        new Request(`http://localhost/snapshots/${id}/archives/singlefile/preview`),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-security-policy")).toContain("default-src");
      expect(await res.text()).toBe("<p>hello</p>");
      expect(bufferedWhole).toBe(false);
    } finally {
      FilesystemBackend.prototype.getBytes = orig;
    }
  });

  test("media-metadata leaves out formats, signed URLs and headers", async () => {
    const info = {
      id: "abc",
      title: "A video",
      uploader: "Someone",
      duration: 61,
      formats: [{ url: "https://r1.example/videoplayback?ip=203.0.113.9&sig=s" }],
      requested_formats: [{ url: "https://r1.example/videoplayback?ip=203.0.113.9" }],
      url: "https://r1.example/videoplayback?ip=203.0.113.9",
      http_headers: { "User-Agent": "x" },
      _version: { version: "2026.1.1" },
    };
    const id = await seed("media-metadata", "media-metadata.json", JSON.stringify(info));
    const app = await getApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots/${id}/archives/media-metadata/download`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ id: "abc", title: "A video", uploader: "Someone", duration: 61 });
    expect(JSON.stringify(body)).not.toContain("203.0.113.9");
  });
});

describe("GET /snapshots/:id/archives/:extractor/download — file extractors", () => {
  test("returns screenshot PNG binary with correct headers", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com/screenshot");
    const snapshotsDir = join(testDir, "snapshots");
    mkdirSync(snapshotsDir, { recursive: true });
    const filePath = join(snapshotsDir, `${id}-screenshot.png`);
    const pngBytes = new Uint8Array([137, 80, 78, 71]); // PNG magic bytes
    writeFileSync(filePath, pngBytes);
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (${id}, ${"screenshot"}, ${filePath})`,
    );
    await db.close();

    const app = await getApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots/${id}/archives/screenshot/download`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    expect(res.headers.get("content-disposition")).toContain("screenshot.png");
  });

  test("returns the thumbnail as WebP", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com/thumb");
    const snapshotsDir = join(testDir, "snapshots");
    mkdirSync(snapshotsDir, { recursive: true });
    const filePath = join(snapshotsDir, `${id}-thumbnail.webp`);
    writeFileSync(filePath, new Uint8Array([0xff, 0xd8, 0xff]));
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (${id}, ${"thumbnail"}, ${filePath})`,
    );
    await db.close();

    const app = await getApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots/${id}/archives/thumbnail/download`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/webp");
    expect(res.headers.get("content-disposition")).toContain("thumbnail.webp");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
  });

  test("returns the video poster as a JPEG", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com/poster");
    const snapshotsDir = join(testDir, "snapshots");
    mkdirSync(snapshotsDir, { recursive: true });
    const filePath = join(snapshotsDir, `${id}-poster.jpg`);
    writeFileSync(filePath, new Uint8Array([0xff, 0xd8, 0xff]));
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (${id}, ${"media-poster"}, ${filePath})`,
    );
    await db.close();

    const app = await getApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots/${id}/archives/media-poster/download`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/jpeg");
    expect(res.headers.get("content-disposition")).toContain("poster.jpg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
  });

  test("returns dom-snapshot HTML with correct headers", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com/dom");
    const snapshotsDir = join(testDir, "snapshots");
    mkdirSync(snapshotsDir, { recursive: true });
    const filePath = join(snapshotsDir, `${id}-dom.html`);
    writeFileSync(filePath, "<html><body>hello</body></html>");
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (${id}, ${"dom-snapshot"}, ${filePath})`,
    );
    await db.close();

    const app = await getApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots/${id}/archives/dom-snapshot/download`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-disposition")).toContain("dom.html");
  });

  test("returns singlefile HTML with correct headers", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com/single");
    const snapshotsDir = join(testDir, "snapshots");
    mkdirSync(snapshotsDir, { recursive: true });
    const filePath = join(snapshotsDir, `${id}-singlefile.html`);
    writeFileSync(filePath, "<!DOCTYPE html><html></html>");
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (${id}, ${"singlefile"}, ${filePath})`,
    );
    await db.close();

    const app = await getApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots/${id}/archives/singlefile/download`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-disposition")).toContain("singlefile.html");
  });

  test("returns 404 when screenshot file does not exist on disk", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const { mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com/missing");
    const snapshotsDir = join(testDir, "snapshots");
    mkdirSync(snapshotsDir, { recursive: true });
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (${id}, ${"screenshot"}, ${join(snapshotsDir, "nonexistent.png")})`,
    );
    await db.close();

    const app = await getApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots/${id}/archives/screenshot/download`),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("file not found");
  });
});

// ---------------------------------------------------------------------------
// GET /snapshots?q= (FTS5 search)
// ---------------------------------------------------------------------------

interface SearchPage {
  items: Array<{ id: number; url: string; snippet: string; rank: number }>;
  total: number;
  page: number;
  limit: number;
}

describe("GET /snapshots?q=", () => {
  test("returns empty paginated result when nothing is indexed", async () => {
    const { openDb } = await import("@webfrost/core");
    await (await openDb(testDir)).close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/snapshots?q=anything"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SearchPage;
    expect(body.items).toHaveLength(0);
    expect(body.total).toBe(0);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
  });

  test("returns ranked results with snippet for indexed snapshot", async () => {
    const { openDb, indexSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    await db.run(sql`INSERT INTO snapshots (url, status) VALUES ('https://example.com', 'done')`);
    await indexSnapshot(
      db,
      1,
      "https://example.com",
      "SQLite Full-Text Search Guide",
      "FTS5 is powerful",
      "",
    );
    await db.close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/snapshots?q=SQLite"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SearchPage;
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.total).toBeGreaterThan(0);
    expect(body.items[0]?.id).toBe(1);
    expect(body.items[0]?.url).toBe("https://example.com");
    expect(typeof body.items[0]?.snippet).toBe("string");
    expect(typeof body.items[0]?.rank).toBe("number");
  });

  test("returns empty items for blank query (falls through to list)", async () => {
    const { openDb } = await import("@webfrost/core");
    await (await openDb(testDir)).close();

    const app = await getApp();
    // Empty q param is treated as missing — returns list, not search
    const res = await app.handle(new Request("http://localhost/snapshots?q="));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SnapshotPage;
    expect(Array.isArray(body.items)).toBe(true);
  });

  test("does not throw on invalid FTS query expression", async () => {
    const { openDb } = await import("@webfrost/core");
    await (await openDb(testDir)).close();

    const app = await getApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots?q=${encodeURIComponent('"unclosed')}`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as SearchPage;
    expect(body.items).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  test("paginates search results with page and limit params", async () => {
    const { openDb, indexSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    await db.run(sql`INSERT INTO snapshots (url, status) VALUES ('https://a.com', 'done')`);
    await db.run(sql`INSERT INTO snapshots (url, status) VALUES ('https://b.com', 'done')`);
    await indexSnapshot(db, 1, "https://a.com", "Archiving Guide Part One", "archive content", "");
    await indexSnapshot(db, 2, "https://b.com", "Archiving Guide Part Two", "archive content", "");
    await db.close();

    const app = await getApp();
    const res = await app.handle(
      new Request("http://localhost/snapshots?q=archive&page=1&limit=1"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as SearchPage;
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// DELETE /snapshots/:id
// ---------------------------------------------------------------------------

describe("DELETE /snapshots/:id", () => {
  test("returns 404 for non-existent snapshot", async () => {
    const { openDb } = await import("@webfrost/core");
    await (await openDb(testDir)).close();

    const app = await getApp();
    const res = await app.handle(
      new Request("http://localhost/snapshots/99999", { method: "DELETE" }),
    );
    expect(res.status).toBe(404);
  });

  test("returns 204 and removes snapshot for existing id", async () => {
    const { openDb, createSnapshot, getSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com/del");
    await db.run(sql`UPDATE snapshots SET status = 'done' WHERE id = ${id}`);
    await db.close();

    const app = await getApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots/${id}`, { method: "DELETE" }),
    );
    expect(res.status).toBe(204);

    // Verify snapshot is gone from the DB
    const db2 = await openDb(testDir);
    const snap = await getSnapshot(db2, id);
    await db2.close();
    expect(snap).toBeNull();
  });

  test("cascades to archive_results on delete", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com/cascade");
    await db.run(sql`UPDATE snapshots SET status = 'done' WHERE id = ${id}`);
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (${id}, 'html', '<p>hi</p>')`,
    );
    await db.close();

    const app = await getApp();
    await app.handle(new Request(`http://localhost/snapshots/${id}`, { method: "DELETE" }));

    const db2 = await openDb(testDir);
    const rows = await db2.all<{ id: number }>(
      sql`SELECT id FROM archive_results WHERE snapshot_id = ${id}`,
    );
    await db2.close();
    expect(rows).toHaveLength(0);
  });

  test("removes snapshot from FTS index on delete", async () => {
    const { openDb, createSnapshot, indexSnapshot, searchSnapshots } = await import(
      "@webfrost/core"
    );
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com/fts-del");
    await db.run(sql`UPDATE snapshots SET status = 'done' WHERE id = ${id}`);
    await indexSnapshot(
      db,
      id,
      "https://example.com/fts-del",
      "Unique FTS Delete Test ZZZ",
      "content",
      "",
    );
    await db.close();

    const app = await getApp();
    await app.handle(new Request(`http://localhost/snapshots/${id}`, { method: "DELETE" }));

    const db2 = await openDb(testDir);
    const results = await searchSnapshots(db2, "ZZZ");
    await db2.close();
    expect(results.items).toHaveLength(0);
  });

  test("refuses with 409 while the snapshot is pending, and keeps its files", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const { existsSync, writeFileSync } = await import("node:fs");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com/running");
    await db.close();
    const dir = join(testDir, "snapshots", String(id));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "page.pdf"), "x");

    const app = await getApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots/${id}`, { method: "DELETE" }),
    );
    expect(res.status).toBe(409);

    const db2 = await openDb(testDir);
    const row = await db2.get<{ id: number }>(sql`SELECT id FROM snapshots WHERE id = ${id}`);
    await db2.close();
    expect(row?.id).toBe(id);
    expect(existsSync(join(dir, "page.pdf"))).toBe(true);
  });

  test("removes the files of a finished snapshot", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const { existsSync, writeFileSync } = await import("node:fs");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com/finished");
    await db.run(sql`UPDATE snapshots SET status = 'failed' WHERE id = ${id}`);
    await db.close();
    const dir = join(testDir, "snapshots", String(id));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "page.pdf"), "x");

    const app = await getApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots/${id}`, { method: "DELETE" }),
    );
    expect(res.status).toBe(204);
    expect(existsSync(dir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /snapshots/:id/retry
// ---------------------------------------------------------------------------

describe("POST /snapshots/:id/retry", () => {
  const post = (path: string) => new Request(`http://localhost${path}`, { method: "POST" });

  const statusRow = async (id: number) => {
    const { openDb } = await import("@webfrost/core");
    const db = await openDb(testDir);
    try {
      return {
        snapshot: (
          await db.get<{ status: string }>(sql`SELECT status FROM snapshots WHERE id = ${id}`)
        )?.status,
        results: Number(
          (
            await db.get<{ n: number }>(
              sql`SELECT COUNT(*) AS n FROM archive_results WHERE snapshot_id = ${id}`,
            )
          )?.n,
        ),
      };
    } finally {
      await db.close();
    }
  };

  test("returns 404 for an unknown id and for one that is not a number", async () => {
    const { openDb } = await import("@webfrost/core");
    await (await openDb(testDir)).close();
    const app = await getApp();
    for (const id of ["99999", "abc", "0", "-3", "1.5"]) {
      const res = await app.handle(post(`/snapshots/${id}/retry`));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not found", code: "NOT_FOUND" });
    }
  });

  test("queues a done snapshot again (202, pending, results cleared) and refuses a second retry (409)", async () => {
    const saved = process.env.WEBFROST_ALLOW_PRIVATE_URLS;
    process.env.WEBFROST_ALLOW_PRIVATE_URLS = "true";
    // A page that answers slowly keeps the pipeline running while we look.
    const server = Bun.serve({
      port: 0,
      async fetch() {
        await Bun.sleep(1500);
        return new Response("<html><body>ok</body></html>", {
          headers: { "content-type": "text/html" },
        });
      },
    });
    try {
      const { openDb, createSnapshot, setJobStatus } = await import("@webfrost/core");
      const db = await openDb(testDir);
      const id = await createSnapshot(db, `http://localhost:${server.port}/page`);
      await db.run(
        sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (${id}, 'html', 'old')`,
      );
      await setJobStatus(db, id, "done");
      await db.close();
      expect(await statusRow(id)).toEqual({ snapshot: "done", results: 1 });

      const app = await getApp();
      const res = await app.handle(post(`/snapshots/${id}/retry`));
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ id, status: "pending" });
      expect(await statusRow(id)).toEqual({ snapshot: "pending", results: 0 });

      const again = await app.handle(post(`/snapshots/${id}/retry`));
      expect(again.status).toBe(409);
      expect(await again.json()).toEqual({ error: "snapshot is being archived", code: "CONFLICT" });
      expect(await statusRow(id)).toEqual({ snapshot: "pending", results: 0 });
    } finally {
      server.stop(true);
      if (saved === undefined) Reflect.deleteProperty(process.env, "WEBFROST_ALLOW_PRIVATE_URLS");
      else process.env.WEBFROST_ALLOW_PRIVATE_URLS = saved;
    }
  });

  test("returns 409 for a snapshot that is still pending, and leaves it alone", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com/pending");
    await db.close();

    const res = await (await getApp()).handle(post(`/snapshots/${id}/retry`));
    expect(res.status).toBe(409);
    expect(await statusRow(id)).toEqual({ snapshot: "pending", results: 0 });
  });

  test("needs credentials: anonymous callers get 401, even with public read on, and nothing changes", async () => {
    const { openDb, createSnapshot, setJobStatus } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com/guarded");
    await setJobStatus(db, id, "done");
    await db.close();

    const savedAuth = process.env.AUTH_DISABLED;
    Reflect.deleteProperty(process.env, "AUTH_DISABLED");
    process.env.SESSION_SECRET = "test-secret-32-chars-long-enough!!";
    try {
      const { authPlugin } = await import("./auth");
      const { snapshotsRouter } = await import("./snapshots");
      const { Elysia } = await import("elysia");
      const app = new Elysia().use(authPlugin).use(snapshotsRouter);
      for (const publicRead of [undefined, "true"]) {
        if (publicRead) process.env.WEBFROST_PUBLIC_READ = publicRead;
        const res = await app.handle(post(`/snapshots/${id}/retry`));
        expect(res.status).toBe(401);
        expect(await statusRow(id)).toEqual({ snapshot: "done", results: 0 });
      }
    } finally {
      if (savedAuth !== undefined) process.env.AUTH_DISABLED = savedAuth;
      Reflect.deleteProperty(process.env, "SESSION_SECRET");
      Reflect.deleteProperty(process.env, "WEBFROST_PUBLIC_READ");
    }
  });
});

// ---------------------------------------------------------------------------
// GET /snapshots/:id
// ---------------------------------------------------------------------------

describe("GET /snapshots/:id", () => {
  test("returns 404 for non-existent snapshot", async () => {
    const { openDb } = await import("@webfrost/core");
    await (await openDb(testDir)).close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/snapshots/99999"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; code: string };
    expect(body).toEqual({ error: "not found", code: "NOT_FOUND" });
  });

  test("returns snapshot with archiveResults for existing snapshot", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com/article");
    await db.close();

    const app = await getApp();
    const res = await app.handle(new Request(`http://localhost/snapshots/${id}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: number;
      url: string;
      archiveResults: unknown[];
    };
    expect(body.id).toBe(id);
    expect(body.url).toBe("https://example.com/article");
    expect(Array.isArray(body.archiveResults)).toBe(true);
  });

  test("extractorMeta includes timing and status for mixed extractor outcomes", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com/video");
    // Insert a successful extractor result with timing
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content, duration_ms) VALUES (${id}, 'readability', ${'{"title":"Test"}'}, 430)`,
    );
    // Insert a failed extractor result
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content, duration_ms, error) VALUES (${id}, 'pdf', NULL, 200, ${"timeout"})`,
    );
    await db.close();

    const app = await getApp();
    const res = await app.handle(new Request(`http://localhost/snapshots/${id}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      extractorMeta: Record<
        string,
        { status: string; durationMs: number | null; fileSizeBytes: number | null; error?: string }
      >;
      archiveResults: unknown[];
    };

    // Successful extractor
    expect(body.extractorMeta.readability).toMatchObject({
      status: "success",
      durationMs: 430,
    });
    // Failed extractor
    expect(body.extractorMeta.pdf).toMatchObject({
      status: "failed",
      durationMs: 200,
      fileSizeBytes: null,
      error: "timeout",
    });
    // Failed results are excluded from archiveResults
    const arExtractors = (body.archiveResults as Array<{ extractor: string }>).map(
      (ar) => ar.extractor,
    );
    expect(arExtractors).toContain("readability");
    expect(arExtractors).not.toContain("pdf");
  });
});

// ---------------------------------------------------------------------------
// Limits, guests and S3 downloads
// ---------------------------------------------------------------------------

describe("GET /snapshots — limit cap", () => {
  test("never returns more than 200 items per page", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    for (let i = 0; i < 205; i++) await createSnapshot(db, `https://example.com/${i}`);
    await db.close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/snapshots?limit=10000"));
    const body = (await res.json()) as { items: unknown[]; limit: number; total: number };
    expect(body.total).toBe(205);
    expect(body.limit).toBe(200);
    expect(body.items).toHaveLength(200);
  });
});

describe("GET /snapshots — page and limit", () => {
  test("values that are not plain numbers answer 400, with and without a query", async () => {
    const app = await getApp();
    for (const qs of [
      "page=Infinity",
      "page=1e400",
      "limit=NaN",
      "q=x&page=Infinity",
      "q=x&page=1e400",
    ]) {
      const res = await app.handle(new Request(`http://localhost/snapshots?${qs}`));
      expect(res.status).toBe(400);
    }
    const huge = await app.handle(
      new Request("http://localhost/snapshots?page=999999999999999&limit=200"),
    );
    expect(huge.status).toBe(200);
  });
});

describe("GET /snapshots/:id — guests", () => {
  test("anonymous visitors never see raw extractor errors", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com/private");
    await db.run(
      sql`INSERT INTO archive_results (snapshot_id, extractor, content, duration_ms, error) VALUES (${id}, 'pdf', NULL, 5, ${"connect ECONNREFUSED 10.0.0.5:9222 (/opt/chrome/chrome)"})`,
    );
    await db.close();

    const savedAuth = process.env.AUTH_DISABLED;
    Reflect.deleteProperty(process.env, "AUTH_DISABLED");
    process.env.SESSION_SECRET = "test-secret-32-chars-long-enough!!";
    process.env.WEBFROST_PUBLIC_READ = "true";
    try {
      const { authPlugin } = await import("./auth");
      const { snapshotsRouter } = await import("./snapshots");
      const { Elysia } = await import("elysia");
      const app = new Elysia().use(authPlugin).use(snapshotsRouter);
      const res = await app.handle(new Request(`http://localhost/snapshots/${id}`));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { extractorMeta: Record<string, { error?: string }> };
      expect(body.extractorMeta.pdf?.error).toBe("extraction failed");
    } finally {
      if (savedAuth !== undefined) process.env.AUTH_DISABLED = savedAuth;
      Reflect.deleteProperty(process.env, "SESSION_SECRET");
      Reflect.deleteProperty(process.env, "WEBFROST_PUBLIC_READ");
    }

    // The admin (here: auth disabled) still gets the real message.
    const res = await (await getApp()).handle(new Request(`http://localhost/snapshots/${id}`));
    const body = (await res.json()) as { extractorMeta: Record<string, { error?: string }> };
    expect(body.extractorMeta.pdf?.error).toContain("ECONNREFUSED");
  });
});

describe("GET /snapshots/:id/archives/:extractor/download — S3", () => {
  const S3_ENV = [
    "WEBFROST_STORAGE_BACKEND",
    "S3_ENDPOINT",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
  ];
  let fakeS3: ReturnType<typeof Bun.serve> | undefined;

  beforeEach(() => {
    // Answers every HEAD (fileExists) with 200; downloads are never proxied.
    fakeS3 = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
    process.env.WEBFROST_STORAGE_BACKEND = "s3";
    process.env.S3_ENDPOINT = `http://127.0.0.1:${fakeS3.port}`;
    process.env.S3_BUCKET = "archive";
    process.env.S3_ACCESS_KEY_ID = "test";
    process.env.S3_SECRET_ACCESS_KEY = "test";
  });

  afterEach(() => {
    fakeS3?.stop(true);
    for (const name of S3_ENV) Reflect.deleteProperty(process.env, name);
  });

  for (const [extractor, filename] of [
    ["dom-snapshot", "dom.html"],
    ["singlefile", "singlefile.html"],
    ["pdf", "page.pdf"],
  ] as const) {
    test(`${extractor} redirects with a signed attachment disposition`, async () => {
      const { openDb, createSnapshot } = await import("@webfrost/core");
      const db = await openDb(testDir);
      const id = await createSnapshot(db, "https://example.com/s3");
      await db.run(
        sql`INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (${id}, ${extractor}, ${`s3:snapshots/${id}/${filename}`})`,
      );
      await db.close();

      const app = await getApp();
      const res = await app.handle(
        new Request(`http://localhost/snapshots/${id}/archives/${extractor}/download`),
      );
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get("location") ?? "");
      expect(location.searchParams.get("response-content-disposition")).toBe(
        `attachment; filename="${filename}"`,
      );
      expect(location.searchParams.get("response-content-type")).toBe(
        extractor === "pdf" ? "application/pdf" : "text/html",
      );
    });
  }
});
