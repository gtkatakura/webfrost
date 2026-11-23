import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { type Db, openDb } from "./db";
import {
  InvalidTagNameError,
  addTagToSnapshot,
  createTag,
  deleteTag,
  getOrCreateTag,
  getTag,
  listSnapshotTags,
  listTags,
  removeTagFromSnapshot,
  slugify,
  tagNameProblem,
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

describe("tag names in any script", () => {
  test("slugify keeps letters and digits of every script", () => {
    expect(slugify("日本語")).toBe("日本語");
    expect(slugify("Привет, мир")).toBe("привет-мир");
    expect(slugify("Ação")).toBe("ação");
    expect(slugify("हिन्दी")).toBe("हिन्दी");
    expect(slugify("!!!")).toBe("");
  });

  test("names that differ only in non-ASCII letters are different tags", async () => {
    const names = ["ação", "aço", "日本", "中国", "русский", "العربية"];
    for (const name of names) await createTag(db, name);
    expect((await listTags(db)).map((t) => t.name).sort()).toEqual([...names].sort());
  });

  test("a name with no letter or digit is refused, and nothing is stored", async () => {
    for (const name of ["!!!", "🔥", "   ", ""]) {
      await expect(createTag(db, name)).rejects.toBeInstanceOf(InvalidTagNameError);
    }
    expect(await listTags(db)).toEqual([]);
  });

  test("createTag trims the name; an equivalent name is a conflict", async () => {
    const tag = await createTag(db, "  News ");
    expect(tag.name).toBe("News");
    await expect(createTag(db, "NEWS!")).rejects.toThrow(/UNIQUE/);
  });

  test("tagNameProblem is the importer's rule", () => {
    expect(tagNameProblem("ok")).toBeNull();
    expect(tagNameProblem(" ok")).not.toBeNull();
    expect(tagNameProblem("x".repeat(101))).not.toBeNull();
    expect(tagNameProblem("!!!")).not.toBeNull();
    expect(tagNameProblem(5)).not.toBeNull();
  });
});

describe("getOrCreateTag", () => {
  test("finds a tag by name or slug and creates it otherwise", async () => {
    const news = await createTag(db, "News");
    expect((await getOrCreateTag(db, "news")).id).toBe(news.id);
    expect((await getOrCreateTag(db, "NEWS!")).id).toBe(news.id);
    const fresh = await getOrCreateTag(db, "日本語");
    expect(fresh.slug).toBe("日本語");
    expect((await getOrCreateTag(db, "日本語")).id).toBe(fresh.id);
    expect(await listTags(db)).toHaveLength(2);
  });

  test("finds a tag stored with a slug from before slugs kept non-ASCII letters", async () => {
    await db.run(
      sql`INSERT INTO tags (name, slug, color, created_at) VALUES ('ação', 'a-o', ${null}, ${db.now()})`,
    );
    const tag = await getOrCreateTag(db, "ação");
    expect(tag.slug).toBe("a-o");
    expect(await listTags(db)).toHaveLength(1);
  });

  test("concurrent calls for one new tag create it once", async () => {
    const tags = await Promise.all(Array.from({ length: 8 }, () => getOrCreateTag(db, "Race")));
    expect(new Set(tags.map((t) => t.id)).size).toBe(1);
    expect(await listTags(db)).toHaveLength(1);
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
