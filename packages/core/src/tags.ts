import type Database from "bun:sqlite";

export interface Tag {
  id: number;
  name: string;
  slug: string;
  color: string | null;
  created_at: string;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function createTag(db: Database, name: string, color?: string): Tag {
  const slug = slugify(name);
  const colorVal = color ?? null;
  db.query<unknown, [string, string, string | null]>(
    "INSERT INTO tags (name, slug, color) VALUES (?, ?, ?)",
  ).run(name, slug, colorVal);
  const tag = db
    .query<Tag, [string]>("SELECT id, name, slug, color, created_at FROM tags WHERE slug = ?")
    .get(slug);
  if (!tag) throw new Error("Tag not found after insert");
  return tag;
}

export function listTags(db: Database): Tag[] {
  return db
    .query<Tag, []>("SELECT id, name, slug, color, created_at FROM tags ORDER BY name")
    .all();
}

export function getTag(db: Database, id: number): Tag | null {
  return db
    .query<Tag, [number]>("SELECT id, name, slug, color, created_at FROM tags WHERE id = ?")
    .get(id);
}

/**
 * Rewrite the `tags` column of a snapshot's full-text index entry from its
 * current tags, so searching by tag name reflects tags added or removed after
 * the snapshot was archived. A snapshot that is not indexed yet is left alone —
 * the pipeline indexes it, tags included, when it finishes.
 */
function syncIndexTags(db: Database, snapshotId: number): void {
  const names = listSnapshotTags(db, snapshotId)
    .map((t) => t.name)
    .join(" ");
  db.query<null, [string, number]>("UPDATE snapshots_fts SET tags = ? WHERE rowid = ?").run(
    names,
    snapshotId,
  );
}

export function deleteTag(db: Database, id: number): boolean {
  const tagged = db
    .query<{ snapshot_id: number }, [number]>(
      "SELECT snapshot_id FROM snapshot_tags WHERE tag_id = ?",
    )
    .all(id);
  const result = db.query<null, [number]>("DELETE FROM tags WHERE id = ?").run(id);
  for (const { snapshot_id } of tagged) syncIndexTags(db, snapshot_id);
  return result.changes > 0;
}

export function addTagToSnapshot(db: Database, snapshotId: number, tagId: number): void {
  db.query<null, [number, number]>(
    "INSERT OR IGNORE INTO snapshot_tags (snapshot_id, tag_id) VALUES (?, ?)",
  ).run(snapshotId, tagId);
  syncIndexTags(db, snapshotId);
}

export function removeTagFromSnapshot(db: Database, snapshotId: number, tagId: number): boolean {
  const result = db
    .query<null, [number, number]>("DELETE FROM snapshot_tags WHERE snapshot_id = ? AND tag_id = ?")
    .run(snapshotId, tagId);
  syncIndexTags(db, snapshotId);
  return result.changes > 0;
}

export function listSnapshotTags(db: Database, snapshotId: number): Tag[] {
  return db
    .query<Tag, [number]>(
      `SELECT t.id, t.name, t.slug, t.color, t.created_at
       FROM tags t
       JOIN snapshot_tags st ON st.tag_id = t.id
       WHERE st.snapshot_id = ?
       ORDER BY t.name`,
    )
    .all(snapshotId);
}
