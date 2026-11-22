import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let testDir: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `webfrost-tags-server-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

async function getTagsApp() {
  const { tagsRouter } = await import("./tags");
  const { Elysia } = await import("elysia");
  return new Elysia().use(tagsRouter);
}

async function getSnapshotTagsApp() {
  const { snapshotTagsRouter } = await import("./tags");
  const { Elysia } = await import("elysia");
  return new Elysia().use(snapshotTagsRouter);
}

// ---------------------------------------------------------------------------
// GET /tags
// ---------------------------------------------------------------------------

describe("GET /tags", () => {
  test("returns empty array when no tags", async () => {
    const { openDb } = await import("@webfrost/core");
    await (await openDb(testDir)).close();

    const app = await getTagsApp();
    const res = await app.handle(new Request("http://localhost/tags"));
    expect(res.status).toBe(200);
    const body = ((await res.json()) as { items: unknown[] }).items;
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  test("returns created tags", async () => {
    const { openDb, createTag } = await import("@webfrost/core");
    const db = await openDb(testDir);
    await createTag(db, "News");
    await db.close();

    const app = await getTagsApp();
    const res = await app.handle(new Request("http://localhost/tags"));
    expect(res.status).toBe(200);
    const body = ((await res.json()) as { items: { name: string; slug: string }[] }).items;
    expect(body).toHaveLength(1);
    expect(body[0]?.name).toBe("News");
    expect(body[0]?.slug).toBe("news");
  });
});

// ---------------------------------------------------------------------------
// POST /tags
// ---------------------------------------------------------------------------

describe("POST /tags", () => {
  test("rejects tag names longer than 100 characters", async () => {
    const { openDb } = await import("@webfrost/core");
    await (await openDb(testDir)).close();

    const app = await getTagsApp();
    const res = await app.handle(
      new Request("http://localhost/tags", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "x".repeat(101) }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid request", code: "VALIDATION" });
  });

  test("creates a tag and returns 201", async () => {
    const { openDb } = await import("@webfrost/core");
    await (await openDb(testDir)).close();

    const app = await getTagsApp();
    const res = await app.handle(
      new Request("http://localhost/tags", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Tech" }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: number; name: string; slug: string; color: null };
    expect(body.name).toBe("Tech");
    expect(body.slug).toBe("tech");
    expect(body.color).toBeNull();
    expect(body.id).toBeGreaterThan(0);
  });

  test("creates a tag with color", async () => {
    const { openDb } = await import("@webfrost/core");
    await (await openDb(testDir)).close();

    const app = await getTagsApp();
    const res = await app.handle(
      new Request("http://localhost/tags", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Urgent", color: "#ff0000" }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { color: string };
    expect(body.color).toBe("#ff0000");
  });

  test("returns 409 on duplicate name", async () => {
    const { openDb, createTag } = await import("@webfrost/core");
    const db = await openDb(testDir);
    await createTag(db, "Dup");
    await db.close();

    const app = await getTagsApp();
    const res = await app.handle(
      new Request("http://localhost/tags", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Dup" }),
      }),
    );
    expect(res.status).toBe(409);
  });

  test("returns 400 for missing name", async () => {
    const { openDb } = await import("@webfrost/core");
    await (await openDb(testDir)).close();

    const app = await getTagsApp();
    const res = await app.handle(
      new Request("http://localhost/tags", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /tags/:id
// ---------------------------------------------------------------------------

describe("DELETE /tags/:id", () => {
  test("deletes existing tag and returns 204", async () => {
    const { openDb, createTag } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const tag = await createTag(db, "DeleteMe");
    await db.close();

    const app = await getTagsApp();
    const res = await app.handle(
      new Request(`http://localhost/tags/${tag.id}`, { method: "DELETE" }),
    );
    expect(res.status).toBe(204);
  });

  test("returns 404 for non-existent tag", async () => {
    const { openDb } = await import("@webfrost/core");
    await (await openDb(testDir)).close();

    const app = await getTagsApp();
    const res = await app.handle(new Request("http://localhost/tags/9999", { method: "DELETE" }));
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /snapshots/:id/tags
// ---------------------------------------------------------------------------

describe("GET /snapshots/:id/tags", () => {
  test("returns 404 for non-existent snapshot", async () => {
    const { openDb } = await import("@webfrost/core");
    await (await openDb(testDir)).close();

    const app = await getSnapshotTagsApp();
    const res = await app.handle(new Request("http://localhost/snapshots/9999/tags"));
    expect(res.status).toBe(404);
  });

  test("returns empty array for snapshot with no tags", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com");
    await db.close();

    const app = await getSnapshotTagsApp();
    const res = await app.handle(new Request(`http://localhost/snapshots/${id}/tags`));
    expect(res.status).toBe(200);
    const body = ((await res.json()) as { items: unknown[] }).items;
    expect(body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST /snapshots/:id/tags
// ---------------------------------------------------------------------------

describe("POST /snapshots/:id/tags", () => {
  test("adds a tag to a snapshot", async () => {
    const { openDb, createSnapshot, createTag } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const snapshotId = await createSnapshot(db, "https://example.com/tagged");
    const tag = await createTag(db, "Important");
    await db.close();

    const app = await getSnapshotTagsApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots/${snapshotId}/tags`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tagId: tag.id }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe("Important");
  });

  test("returns 404 for non-existent snapshot", async () => {
    const { openDb, createTag } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const tag = await createTag(db, "Ghost");
    await db.close();

    const app = await getSnapshotTagsApp();
    const res = await app.handle(
      new Request("http://localhost/snapshots/9999/tags", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tagId: tag.id }),
      }),
    );
    expect(res.status).toBe(404);
  });

  test("returns 404 for non-existent tag", async () => {
    const { openDb, createSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const id = await createSnapshot(db, "https://example.com/snap");
    await db.close();

    const app = await getSnapshotTagsApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots/${id}/tags`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tagId: 9999 }),
      }),
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /snapshots/:id/tags/:tagId
// ---------------------------------------------------------------------------

describe("DELETE /snapshots/:id/tags/:tagId", () => {
  test("removes a tag from a snapshot", async () => {
    const { openDb, createSnapshot, createTag, addTagToSnapshot } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const snapshotId = await createSnapshot(db, "https://example.com/rem");
    const tag = await createTag(db, "Removable");
    await addTagToSnapshot(db, snapshotId, tag.id);
    await db.close();

    const app = await getSnapshotTagsApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots/${snapshotId}/tags/${tag.id}`, {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(204);
  });

  test("returns 404 when tag not on snapshot", async () => {
    const { openDb, createSnapshot, createTag } = await import("@webfrost/core");
    const db = await openDb(testDir);
    const snapshotId = await createSnapshot(db, "https://example.com/notag");
    const tag = await createTag(db, "NotPresent");
    await db.close();

    const app = await getSnapshotTagsApp();
    const res = await app.handle(
      new Request(`http://localhost/snapshots/${snapshotId}/tags/${tag.id}`, {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(404);
  });
});
