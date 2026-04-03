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

describe("GET /snapshots", () => {
  test("returns empty array when no snapshots exist", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/snapshots"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  test("returns snapshot list after adding a snapshot", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = openDb(testDir);
    createSnapshot(db, "https://example.com");
    db.close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/snapshots"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      id: number;
      url: string;
      status: string;
      createdAt: string;
      extractors: string[];
    }>;
    expect(body).toHaveLength(1);
    expect(body[0]?.url).toBe("https://example.com");
    expect(body[0]).toHaveProperty("id");
    expect(body[0]).toHaveProperty("status");
    expect(body[0]).toHaveProperty("createdAt");
    expect(Array.isArray(body[0]?.extractors)).toBe(true);
    expect(body[0]?.extractors).toHaveLength(0);
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
    const body = (await res.json()) as Array<{ extractors: string[] }>;
    expect(body[0]?.extractors).toContain("readability");
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
});

// ---------------------------------------------------------------------------
// GET /snapshots?q= (FTS5 search)
// ---------------------------------------------------------------------------

describe("GET /snapshots?q=", () => {
  test("returns empty array when nothing is indexed", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/snapshots?q=anything"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
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
    const body = (await res.json()) as Array<{
      id: number;
      url: string;
      snippet: string;
      rank: number;
    }>;
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]?.id).toBe(1);
    expect(body[0]?.url).toBe("https://example.com");
    expect(typeof body[0]?.snippet).toBe("string");
    expect(typeof body[0]?.rank).toBe("number");
  });

  test("returns empty array for blank query (falls through to list)", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    // Empty q param is treated as missing — returns list, not search
    const res = await app.handle(new Request("http://localhost/snapshots?q="));
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  test("does not throw on invalid FTS query expression", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots?q=${encodeURIComponent('"unclosed')}`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
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
    expect(results).toHaveLength(0);
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
