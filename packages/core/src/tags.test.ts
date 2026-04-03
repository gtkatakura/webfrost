import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "./db";
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
let db: ReturnType<typeof openDb>;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `webfrost-tags-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  db = openDb(testDir);
});

afterEach(() => {
  db.close();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

describe("slugify", () => {
  test("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  test("strips leading and trailing hyphens", () => {
    expect(slugify("  test  ")).toBe("test");
  });

  test("collapses multiple special chars", () => {
    expect(slugify("foo & bar!")).toBe("foo-bar");
  });

  test("preserves numbers", () => {
    expect(slugify("web 2.0")).toBe("web-2-0");
  });
});

describe("createTag", () => {
  test("creates a tag and returns it", () => {
    const tag = createTag(db, "News");
    expect(tag.name).toBe("News");
    expect(tag.slug).toBe("news");
    expect(tag.color).toBeNull();
    expect(tag.id).toBeGreaterThan(0);
    expect(tag.created_at).toBeTruthy();
  });

  test("creates a tag with color", () => {
    const tag = createTag(db, "Urgent", "#ff0000");
    expect(tag.color).toBe("#ff0000");
  });

  test("throws on duplicate name", () => {
    createTag(db, "News");
    expect(() => createTag(db, "News")).toThrow();
  });
});

describe("listTags", () => {
  test("returns empty array when no tags", () => {
    expect(listTags(db)).toEqual([]);
  });

  test("returns tags sorted by name", () => {
    createTag(db, "Zebra");
    createTag(db, "Apple");
    const tags = listTags(db);
    expect(tags).toHaveLength(2);
    expect(tags[0]?.name).toBe("Apple");
    expect(tags[1]?.name).toBe("Zebra");
  });
});

describe("getTag", () => {
  test("returns null for non-existent id", () => {
    expect(getTag(db, 9999)).toBeNull();
  });

  test("returns tag by id", () => {
    const created = createTag(db, "Tech");
    const found = getTag(db, created.id);
    expect(found?.name).toBe("Tech");
  });
});

describe("deleteTag", () => {
  test("returns false for non-existent tag", () => {
    expect(deleteTag(db, 9999)).toBe(false);
  });

  test("deletes existing tag and returns true", () => {
    const tag = createTag(db, "ToDelete");
    expect(deleteTag(db, tag.id)).toBe(true);
    expect(getTag(db, tag.id)).toBeNull();
  });
});

describe("snapshot_tags", () => {
  function createSnapshot(url: string): number {
    const result = db
      .query<{ id: number }, [string]>(
        "INSERT INTO snapshots (url, status) VALUES (?, 'pending') RETURNING id",
      )
      .get(url);
    if (!result) throw new Error("Insert failed");
    return result.id;
  }

  test("addTagToSnapshot and listSnapshotTags", () => {
    const snapshotId = createSnapshot("https://example.com");
    const tag = createTag(db, "Finance");
    addTagToSnapshot(db, snapshotId, tag.id);
    const tags = listSnapshotTags(db, snapshotId);
    expect(tags).toHaveLength(1);
    expect(tags[0]?.name).toBe("Finance");
  });

  test("addTagToSnapshot is idempotent", () => {
    const snapshotId = createSnapshot("https://example.com/2");
    const tag = createTag(db, "Idempotent");
    addTagToSnapshot(db, snapshotId, tag.id);
    addTagToSnapshot(db, snapshotId, tag.id); // should not throw
    expect(listSnapshotTags(db, snapshotId)).toHaveLength(1);
  });

  test("removeTagFromSnapshot returns true when removed", () => {
    const snapshotId = createSnapshot("https://example.com/3");
    const tag = createTag(db, "Removable");
    addTagToSnapshot(db, snapshotId, tag.id);
    expect(removeTagFromSnapshot(db, snapshotId, tag.id)).toBe(true);
    expect(listSnapshotTags(db, snapshotId)).toHaveLength(0);
  });

  test("removeTagFromSnapshot returns false when not present", () => {
    const snapshotId = createSnapshot("https://example.com/4");
    const tag = createTag(db, "NotPresent");
    expect(removeTagFromSnapshot(db, snapshotId, tag.id)).toBe(false);
  });

  test("listSnapshotTags returns empty for snapshot with no tags", () => {
    const snapshotId = createSnapshot("https://example.com/5");
    expect(listSnapshotTags(db, snapshotId)).toEqual([]);
  });

  test("deleting a tag cascades and removes snapshot_tags entries", () => {
    const snapshotId = createSnapshot("https://example.com/6");
    const tag = createTag(db, "CascadeTest");
    addTagToSnapshot(db, snapshotId, tag.id);
    deleteTag(db, tag.id);
    expect(listSnapshotTags(db, snapshotId)).toHaveLength(0);
  });
});
