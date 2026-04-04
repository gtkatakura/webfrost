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
  process.env.WEBFROST_DIR = undefined;
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
});
