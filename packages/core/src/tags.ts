import { sql } from "kysely";
import { type Db, isUniqueViolation } from "./db";
import { updateIndexedTags } from "./search";

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

const TAG_COLS = sql`id, name, slug, color, created_at`;

/**
 * Create a tag. A duplicate name or slug throws an error whose message contains
 * "UNIQUE constraint failed", on every database, so callers can map it to 409.
 */
export async function createTag(db: Db, name: string, color?: string): Promise<Tag> {
  const slug = slugify(name);
  try {
    await db.run(
      sql`INSERT INTO tags (name, slug, color, created_at) VALUES (${name}, ${slug}, ${color ?? null}, ${db.now()})`,
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw new Error("UNIQUE constraint failed: tags.slug");
    throw err;
  }
  const tag = await db.get<Tag>(sql`SELECT ${TAG_COLS} FROM tags WHERE slug = ${slug}`);
  if (!tag) throw new Error("Tag not found after insert");
  return tag;
}

export async function listTags(db: Db): Promise<Tag[]> {
  return db.all<Tag>(sql`SELECT ${TAG_COLS} FROM tags ORDER BY name`);
}

export async function getTag(db: Db, id: number): Promise<Tag | null> {
  return db.get<Tag>(sql`SELECT ${TAG_COLS} FROM tags WHERE id = ${id}`);
}

/**
 * Rewrite the tag names in a snapshot's full-text index entry from its current
 * tags, so searching by tag name reflects tags added or removed after the
 * snapshot was archived.
 */
async function syncIndexTags(db: Db, snapshotId: number): Promise<void> {
  const names = (await listSnapshotTags(db, snapshotId)).map((t) => t.name).join(" ");
  await updateIndexedTags(db, snapshotId, names);
}

export async function deleteTag(db: Db, id: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    const tagged = await tx.all<{ snapshot_id: number }>(
      sql`SELECT snapshot_id FROM snapshot_tags WHERE tag_id = ${id}`,
    );
    const changes = await tx.run(sql`DELETE FROM tags WHERE id = ${id}`);
    for (const { snapshot_id } of tagged) await syncIndexTags(tx, snapshot_id);
    return changes > 0;
  });
}

export async function addTagToSnapshot(db: Db, snapshotId: number, tagId: number): Promise<void> {
  await db.transaction(async (tx) => {
    // Already tagged is fine; a missing snapshot or tag still fails (foreign keys).
    switch (tx.dialect) {
      case "sqlite":
        await tx.run(
          sql`INSERT OR IGNORE INTO snapshot_tags (snapshot_id, tag_id) VALUES (${snapshotId}, ${tagId})`,
        );
        break;
      case "postgres":
        await tx.run(
          sql`INSERT INTO snapshot_tags (snapshot_id, tag_id) VALUES (${snapshotId}, ${tagId}) ON CONFLICT DO NOTHING`,
        );
        break;
      case "mysql":
        // Not INSERT IGNORE: that would also turn foreign-key errors into warnings.
        await tx.run(
          sql`INSERT INTO snapshot_tags (snapshot_id, tag_id) VALUES (${snapshotId}, ${tagId}) ON DUPLICATE KEY UPDATE tag_id = tag_id`,
        );
        break;
    }
    await syncIndexTags(tx, snapshotId);
  });
}

export async function removeTagFromSnapshot(
  db: Db,
  snapshotId: number,
  tagId: number,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const changes = await tx.run(
      sql`DELETE FROM snapshot_tags WHERE snapshot_id = ${snapshotId} AND tag_id = ${tagId}`,
    );
    await syncIndexTags(tx, snapshotId);
    return changes > 0;
  });
}

export async function listSnapshotTags(db: Db, snapshotId: number): Promise<Tag[]> {
  return db.all<Tag>(
    sql`SELECT t.id, t.name, t.slug, t.color, t.created_at
        FROM tags t
        JOIN snapshot_tags st ON st.tag_id = t.id
        WHERE st.snapshot_id = ${snapshotId}
        ORDER BY t.name`,
  );
}
