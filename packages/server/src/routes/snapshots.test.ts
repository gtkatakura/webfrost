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
