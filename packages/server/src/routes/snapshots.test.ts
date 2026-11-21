import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let testDir: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `webfrost-server-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  process.env.WEBFROST_DIR = testDir;
});

afterEach(() => {
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
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: "invalid url" });
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
      openDb(testDir).close();

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
    openDb(testDir).close();

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
    const db = openDb(testDir);
    createSnapshot(db, "https://example.com");
    db.close();

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
    const db = openDb(testDir);
    const id = createSnapshot(db, "https://example.com/ext");
    db.query("INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, ?, ?)").run(
      id,
      "readability",
      JSON.stringify({ title: "Test", textContent: "hello" }),
    );
    db.close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/snapshots"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SnapshotPage;
    expect(body.items[0]?.extractors).toContain("readability");
  });

  test("paginates snapshot list with page and limit params", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = openDb(testDir);
    createSnapshot(db, "https://first.com");
    createSnapshot(db, "https://second.com");
    createSnapshot(db, "https://third.com");
    db.close();

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
    const db = openDb(testDir);
    const id = createSnapshot(db, "https://example.com/article");
    const snapshotsDir = join(testDir, "snapshots");
    mkdirSync(snapshotsDir, { recursive: true });
    const screenshotPath = join(snapshotsDir, `${id}-screenshot.png`);
    writeFileSync(screenshotPath, new Uint8Array([137, 80, 78, 71]));
    db.query("INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, ?, ?)").run(
      id,
      "readability",
      JSON.stringify({
        title: "Test Article",
        excerpt: "A short excerpt about something.",
        byline: null,
        textContent: null,
      }),
    );
    db.query("INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, ?, ?)").run(
      id,
      "screenshot",
      screenshotPath,
    );
    db.close();

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
    expect(item?.screenshotUrl).toBe(`/api/snapshots/${id}/archives/screenshot/download`);
  });

  test("returns null title, excerpt, screenshotUrl when extractors did not run", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = openDb(testDir);
    createSnapshot(db, "https://example.com/bare");
    db.close();

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
    const db = openDb(testDir);
    const id = createSnapshot(db, "https://example.com/long");
    const longExcerpt = "x".repeat(200);
    db.query("INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, ?, ?)").run(
      id,
      "readability",
      JSON.stringify({ title: "Long", excerpt: longExcerpt, byline: null, textContent: null }),
    );
    db.close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/snapshots"));
    const body = (await res.json()) as { items: Array<{ excerpt: string | null }> };
    expect(body.items[0]?.excerpt?.length).toBe(120);
  });

  test("filters snapshots by status query param", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = openDb(testDir);
    const pendingId = createSnapshot(db, "https://pending.com");
    const doneId = createSnapshot(db, "https://done.com");
    db.query("UPDATE snapshots SET status = 'done' WHERE id = ?").run(doneId);
    db.close();

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
    const db = openDb(testDir);
    createSnapshot(db, "https://a.com");
    const id2 = createSnapshot(db, "https://b.com");
    db.query("UPDATE snapshots SET status = 'done' WHERE id = ?").run(id2);
    db.close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/snapshots"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SnapshotPage;
    expect(body.items).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  test("returns empty when status filter matches no snapshots", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = openDb(testDir);
    createSnapshot(db, "https://example.com");
    db.close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/snapshots?status=done"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SnapshotPage;
    expect(body.items).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  test("returns empty items for out-of-range page", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = openDb(testDir);
    createSnapshot(db, "https://example.com");
    db.close();

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
    openDb(testDir).close();

    const app = await getApp();
    const res = await app.handle(
      new Request("http://localhost/snapshots/99999/archives/readability/download"),
    );
    expect(res.status).toBe(404);
  });

  test("returns 404 when extractor result has no content", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = openDb(testDir);
    const id = createSnapshot(db, "https://example.com");
    db.query(
      "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, ?, NULL)",
    ).run(id, "readability");
    db.close();

    const app = await getApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots/${id}/archives/readability/download`),
    );
    expect(res.status).toBe(404);
  });

  test("returns readability JSON content for download", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = openDb(testDir);
    const id = createSnapshot(db, "https://example.com/read");
    const content = JSON.stringify({ title: "Hello", textContent: "World" });
    db.query("INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, ?, ?)").run(
      id,
      "readability",
      content,
    );
    db.close();

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
    const db = openDb(testDir);
    const id = createSnapshot(db, "https://example.com");
    db.close();

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
    const db = openDb(testDir);
    const id = createSnapshot(db, "https://example.com");
    // Inject a path traversal value into the DB
    db.query("INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, ?, ?)").run(
      id,
      "warc",
      "/etc/passwd",
    );
    db.close();

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
    const db = openDb(testDir);
    const id = createSnapshot(db, "https://example.com");
    db.query("INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, ?, ?)").run(
      id,
      "pdf",
      "/etc/shadow",
    );
    db.close();

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
    const db = openDb(testDir);
    const id = createSnapshot(db, "https://example.com");
    db.query("INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, ?, ?)").run(
      id,
      "screenshot",
      "/etc/passwd",
    );
    db.close();

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
    const db = openDb(testDir);
    const id = createSnapshot(db, "https://example.com");
    db.query("INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, ?, ?)").run(
      id,
      "dom-snapshot",
      "/etc/hosts",
    );
    db.close();

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
    const db = openDb(testDir);
    const id = createSnapshot(db, "https://example.com");
    db.query("INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, ?, ?)").run(
      id,
      "singlefile",
      "/etc/hostname",
    );
    db.close();

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

describe("GET /snapshots/:id/archives/:extractor/download — file extractors", () => {
  test("returns screenshot PNG binary with correct headers", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const db = openDb(testDir);
    const id = createSnapshot(db, "https://example.com/screenshot");
    const snapshotsDir = join(testDir, "snapshots");
    mkdirSync(snapshotsDir, { recursive: true });
    const filePath = join(snapshotsDir, `${id}-screenshot.png`);
    const pngBytes = new Uint8Array([137, 80, 78, 71]); // PNG magic bytes
    writeFileSync(filePath, pngBytes);
    db.query("INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, ?, ?)").run(
      id,
      "screenshot",
      filePath,
    );
    db.close();

    const app = await getApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots/${id}/archives/screenshot/download`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    expect(res.headers.get("content-disposition")).toContain("screenshot.png");
  });

  test("returns dom-snapshot HTML with correct headers", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const db = openDb(testDir);
    const id = createSnapshot(db, "https://example.com/dom");
    const snapshotsDir = join(testDir, "snapshots");
    mkdirSync(snapshotsDir, { recursive: true });
    const filePath = join(snapshotsDir, `${id}-dom.html`);
    writeFileSync(filePath, "<html><body>hello</body></html>");
    db.query("INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, ?, ?)").run(
      id,
      "dom-snapshot",
      filePath,
    );
    db.close();

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
    const db = openDb(testDir);
    const id = createSnapshot(db, "https://example.com/single");
    const snapshotsDir = join(testDir, "snapshots");
    mkdirSync(snapshotsDir, { recursive: true });
    const filePath = join(snapshotsDir, `${id}-singlefile.html`);
    writeFileSync(filePath, "<!DOCTYPE html><html></html>");
    db.query("INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, ?, ?)").run(
      id,
      "singlefile",
      filePath,
    );
    db.close();

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
    const db = openDb(testDir);
    const id = createSnapshot(db, "https://example.com/missing");
    const snapshotsDir = join(testDir, "snapshots");
    mkdirSync(snapshotsDir, { recursive: true });
    db.query("INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, ?, ?)").run(
      id,
      "screenshot",
      join(snapshotsDir, "nonexistent.png"),
    );
    db.close();

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
    openDb(testDir).close();

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
    const db = openDb(testDir);
    db.query("INSERT INTO snapshots (url, status) VALUES ('https://example.com', 'done')").run();
    indexSnapshot(
      db,
      1,
      "https://example.com",
      "SQLite Full-Text Search Guide",
      "FTS5 is powerful",
      "",
    );
    db.close();

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
    openDb(testDir).close();

    const app = await getApp();
    // Empty q param is treated as missing — returns list, not search
    const res = await app.handle(new Request("http://localhost/snapshots?q="));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SnapshotPage;
    expect(Array.isArray(body.items)).toBe(true);
  });

  test("does not throw on invalid FTS query expression", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

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
    const db = openDb(testDir);
    db.query("INSERT INTO snapshots (url, status) VALUES ('https://a.com', 'done')").run();
    db.query("INSERT INTO snapshots (url, status) VALUES ('https://b.com', 'done')").run();
    indexSnapshot(db, 1, "https://a.com", "Archiving Guide Part One", "archive content", "");
    indexSnapshot(db, 2, "https://b.com", "Archiving Guide Part Two", "archive content", "");
    db.close();

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
    openDb(testDir).close();

    const app = await getApp();
    const res = await app.handle(
      new Request("http://localhost/snapshots/99999", { method: "DELETE" }),
    );
    expect(res.status).toBe(404);
  });

  test("returns 204 and removes snapshot for existing id", async () => {
    const { openDb, createSnapshot, getSnapshot } = await import("@webfrost/core");
    const db = openDb(testDir);
    const id = createSnapshot(db, "https://example.com/del");
    db.close();

    const app = await getApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots/${id}`, { method: "DELETE" }),
    );
    expect(res.status).toBe(204);

    // Verify snapshot is gone from the DB
    const db2 = openDb(testDir);
    const snap = getSnapshot(db2, id);
    db2.close();
    expect(snap).toBeNull();
  });

  test("cascades to archive_results on delete", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = openDb(testDir);
    const id = createSnapshot(db, "https://example.com/cascade");
    db.query(
      "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'html', '<p>hi</p>')",
    ).run(id);
    db.close();

    const app = await getApp();
    await app.handle(new Request(`http://localhost/snapshots/${id}`, { method: "DELETE" }));

    const db2 = openDb(testDir);
    const rows = db2
      .query<{ id: number }, [number]>("SELECT id FROM archive_results WHERE snapshot_id = ?")
      .all(id);
    db2.close();
    expect(rows).toHaveLength(0);
  });

  test("removes snapshot from FTS index on delete", async () => {
    const { openDb, createSnapshot, indexSnapshot, searchSnapshots } = await import(
      "@webfrost/core"
    );
    const db = openDb(testDir);
    const id = createSnapshot(db, "https://example.com/fts-del");
    indexSnapshot(
      db,
      id,
      "https://example.com/fts-del",
      "Unique FTS Delete Test ZZZ",
      "content",
      "",
    );
    db.close();

    const app = await getApp();
    await app.handle(new Request(`http://localhost/snapshots/${id}`, { method: "DELETE" }));

    const db2 = openDb(testDir);
    const results = searchSnapshots(db2, "ZZZ");
    db2.close();
    expect(results.items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GET /snapshots/:id
// ---------------------------------------------------------------------------

describe("GET /snapshots/:id", () => {
  test("returns 404 for non-existent snapshot", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/snapshots/99999"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: "not found" });
  });

  test("returns snapshot with archiveResults for existing snapshot", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = openDb(testDir);
    const id = createSnapshot(db, "https://example.com/article");
    db.close();

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
    const db = openDb(testDir);
    const id = createSnapshot(db, "https://example.com/video");
    // Insert a successful extractor result with timing
    db.query(
      "INSERT INTO archive_results (snapshot_id, extractor, content, duration_ms) VALUES (?, ?, ?, ?)",
    ).run(id, "readability", '{"title":"Test"}', 430);
    // Insert a failed extractor result
    db.query(
      "INSERT INTO archive_results (snapshot_id, extractor, content, duration_ms, error) VALUES (?, ?, ?, ?, ?)",
    ).run(id, "pdf", null, 200, "timeout");
    db.close();

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
    const db = openDb(testDir);
    for (let i = 0; i < 205; i++) createSnapshot(db, `https://example.com/${i}`);
    db.close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/snapshots?limit=10000"));
    const body = (await res.json()) as { items: unknown[]; limit: number; total: number };
    expect(body.total).toBe(205);
    expect(body.limit).toBe(200);
    expect(body.items).toHaveLength(200);
  });
});

describe("GET /snapshots/:id — guests", () => {
  test("anonymous visitors never see raw extractor errors", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = openDb(testDir);
    const id = createSnapshot(db, "https://example.com/private");
    db.query(
      "INSERT INTO archive_results (snapshot_id, extractor, content, duration_ms, error) VALUES (?, ?, ?, ?, ?)",
    ).run(id, "pdf", null, 5, "connect ECONNREFUSED 10.0.0.5:9222 (/opt/chrome/chrome)");
    db.close();

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
      const db = openDb(testDir);
      const id = createSnapshot(db, "https://example.com/s3");
      db.query(
        "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, ?, ?)",
      ).run(id, extractor, `s3:snapshots/${id}/${filename}`);
      db.close();

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
