import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { type Db, openDb } from "./db";
import {
  addTagToSnapshot,
  createTag,
  deleteTag,
  getTag,
  listSnapshotTags,
  listTags,
  removeTagFromSnapshot,
  slugify,
} from "./tags";

let testDir: string;
let db: Db;

beforeEach(async () => {
  testDir = join(
    tmpdir(),
    `webfrost-tags-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  db = await openDb(testDir);
});

afterEach(async () => {
  await db.close();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

describe("slugify", () => {
  test("lowercases and replaces spaces with hyphens", async () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  test("strips leading and trailing hyphens", async () => {
    expect(slugify("  test  ")).toBe("test");
  });

  test("collapses multiple special chars", async () => {
    expect(slugify("foo & bar!")).toBe("foo-bar");
  });

  test("preserves numbers", async () => {
    expect(slugify("web 2.0")).toBe("web-2-0");
  });
});

describe("createTag", () => {
  test("creates a tag and returns it", async () => {
    const tag = await createTag(db, "News");
    expect(tag.name).toBe("News");
    expect(tag.slug).toBe("news");
    expect(tag.color).toBeNull();
    expect(tag.id).toBeGreaterThan(0);
    expect(tag.created_at).toBeTruthy();
  });

  test("creates a tag with color", async () => {
    const tag = await createTag(db, "Urgent", "#ff0000");
    expect(tag.color).toBe("#ff0000");
  });

  test("throws on duplicate name", async () => {
    await createTag(db, "News");
    await expect(createTag(db, "News")).rejects.toThrow();
  });
});

describe("listTags", () => {
  test("returns empty array when no tags", async () => {
    expect(await listTags(db)).toEqual([]);
  });

  test("returns tags sorted by name", async () => {
    await createTag(db, "Zebra");
    await createTag(db, "Apple");
    const tags = await listTags(db);
    expect(tags).toHaveLength(2);
    expect(tags[0]?.name).toBe("Apple");
    expect(tags[1]?.name).toBe("Zebra");
  });
});

describe("getTag", () => {
  test("returns null for non-existent id", async () => {
    expect(await getTag(db, 9999)).toBeNull();
  });

  test("returns tag by id", async () => {
    const created = await createTag(db, "Tech");
    const found = await getTag(db, created.id);
    expect(found?.name).toBe("Tech");
  });
});

describe("deleteTag", () => {
  test("returns false for non-existent tag", async () => {
    expect(await deleteTag(db, 9999)).toBe(false);
  });

  test("deletes existing tag and returns true", async () => {
    const tag = await createTag(db, "ToDelete");
    expect(await deleteTag(db, tag.id)).toBe(true);
    expect(await getTag(db, tag.id)).toBeNull();
  });
});

describe("snapshot_tags", () => {
  async function createSnapshot(url: string): Promise<number> {
    return db.insert(sql`INSERT INTO snapshots (url, status) VALUES (${url}, 'pending')`);
  }

  test("addTagToSnapshot and listSnapshotTags", async () => {
    const snapshotId = await createSnapshot("https://example.com");
    const tag = await createTag(db, "Finance");
    await addTagToSnapshot(db, snapshotId, tag.id);
    const tags = await listSnapshotTags(db, snapshotId);
    expect(tags).toHaveLength(1);
    expect(tags[0]?.name).toBe("Finance");
  });

  test("addTagToSnapshot is idempotent", async () => {
    const snapshotId = await createSnapshot("https://example.com/2");
    const tag = await createTag(db, "Idempotent");
    await addTagToSnapshot(db, snapshotId, tag.id);
    await addTagToSnapshot(db, snapshotId, tag.id); // should not throw
    expect(await listSnapshotTags(db, snapshotId)).toHaveLength(1);
  });

  test("removeTagFromSnapshot returns true when removed", async () => {
    const snapshotId = await createSnapshot("https://example.com/3");
    const tag = await createTag(db, "Removable");
    await addTagToSnapshot(db, snapshotId, tag.id);
    expect(await removeTagFromSnapshot(db, snapshotId, tag.id)).toBe(true);
    expect(await listSnapshotTags(db, snapshotId)).toHaveLength(0);
  });

  test("removeTagFromSnapshot returns false when not present", async () => {
    const snapshotId = await createSnapshot("https://example.com/4");
    const tag = await createTag(db, "NotPresent");
    expect(await removeTagFromSnapshot(db, snapshotId, tag.id)).toBe(false);
  });

  test("listSnapshotTags returns empty for snapshot with no tags", async () => {
    const snapshotId = await createSnapshot("https://example.com/5");
    expect(await listSnapshotTags(db, snapshotId)).toEqual([]);
  });

  test("deleting a tag cascades and removes snapshot_tags entries", async () => {
    const snapshotId = await createSnapshot("https://example.com/6");
    const tag = await createTag(db, "CascadeTest");
    await addTagToSnapshot(db, snapshotId, tag.id);
    await deleteTag(db, tag.id);
    expect(await listSnapshotTags(db, snapshotId)).toHaveLength(0);
  });
});
