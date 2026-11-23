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

/** Longest tag name, in UTF-16 code units. */
export const MAX_TAG_NAME_LENGTH = 100;
/** The tags.slug column is VARCHAR(255) on MySQL. */
const MAX_SLUG_LENGTH = 255;

/**
 * The key that makes two tag names "the same tag": NFKC-normalised, lowercased, with every
 * run of characters that are not letters, digits or combining marks (in any script) turned
 * into one hyphen. "Ação" gives "ação", "日本語" stays "日本語"; a name made only of
 * symbols gives "".
 */
export function slugify(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
    .replace(/^-|-$/g, "");
}

/** Thrown for a tag name no tag can have. The message says why. */
export class InvalidTagNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTagNameError";
  }
}

/**
 * The one rule for tag names (the API, the CLI and bundles share it): why `name` cannot be
 * a tag name, or null when it can. Names are not trimmed here: callers that accept user
 * input trim first (see normalizeTagName).
 */
export function tagNameProblem(name: unknown): string | null {
  if (typeof name !== "string") return "a tag name must be a string";
  if (name.trim() !== name) return "a tag name must not start or end with whitespace";
  if (name.length === 0) return "a tag name must not be empty";
  if (name.length > MAX_TAG_NAME_LENGTH)
    return `a tag name must be at most ${MAX_TAG_NAME_LENGTH} characters`;
  const slug = slugify(name);
  if (slug === "") return "a tag name needs at least one letter or digit";
  if (slug.length > MAX_SLUG_LENGTH) return "a tag name is too long";
  return null;
}

/** Trim `name` and check it against tagNameProblem; throws InvalidTagNameError. */
export function normalizeTagName(name: string): string {
  const trimmed = name.trim();
  const problem = tagNameProblem(trimmed);
  if (problem) throw new InvalidTagNameError(problem);
  return trimmed;
}

const TAG_COLS = sql`id, name, slug, color, created_at`;

/**
 * Create a tag. A duplicate name or slug throws an error whose message contains
 * "UNIQUE constraint failed", on every database, so callers can map it to 409.
 */
export async function createTag(db: Db, rawName: string, color?: string): Promise<Tag> {
  const name = normalizeTagName(rawName);
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

/**
 * The tag a name refers to: the one with exactly that name, else the one with the same slug
 * (tags are unique by slug, so "News" and "news" are one tag). Tags created before slugs
 * kept non-ASCII letters have an older slug, which is why the exact name is checked too.
 */
export async function findTagByName(db: Db, name: string): Promise<Tag | null> {
  const slug = slugify(name);
  return db.get<Tag>(
    sql`SELECT ${TAG_COLS} FROM tags WHERE name = ${name} OR slug = ${slug} ORDER BY (name = ${name}) DESC, id LIMIT 1 ${db.forShare()}`,
  );
}

/**
 * The tag a name refers to (see findTagByName), created when there is none. Safe when
 * another process creates the same tag at the same moment, on every database.
 */
export async function getOrCreateTag(db: Db, rawName: string): Promise<Tag> {
  const name = normalizeTagName(rawName);
  const existing = await findTagByName(db, name);
  if (existing) return existing;
  const slug = slugify(name);
  const values = sql`(${name}, ${slug}, ${null}, ${db.now()})`;
  switch (db.dialect) {
    case "sqlite":
      await db.run(
        sql`INSERT OR IGNORE INTO tags (name, slug, color, created_at) VALUES ${values}`,
      );
      break;
    case "postgres":
      await db.run(
        sql`INSERT INTO tags (name, slug, color, created_at) VALUES ${values} ON CONFLICT DO NOTHING`,
      );
      break;
    case "mysql":
      await db.run(
        sql`INSERT INTO tags (name, slug, color, created_at) VALUES ${values} ON DUPLICATE KEY UPDATE id = id`,
      );
      break;
  }
  // A locking read (forShare) sees what a concurrent transaction committed meanwhile.
  const tag = await findTagByName(db, name);
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

/**
 * Serialise tag changes of one snapshot on PostgreSQL and MySQL (SQLite has one writer):
 * the index entry is rewritten from a read of the snapshot's tags, which must not run
 * before an earlier change has committed.
 */
async function lockSnapshot(tx: Db, snapshotId: number): Promise<void> {
  await tx.run(sql`SELECT id FROM snapshots WHERE id = ${snapshotId} ${tx.forUpdate()}`);
}

export async function deleteTag(db: Db, id: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Lock the tag first, so no snapshot gets it between the read below and the delete.
    await tx.run(sql`SELECT id FROM tags WHERE id = ${id} ${tx.forUpdate()}`);
    const tagged = await tx.all<{ snapshot_id: number }>(
      sql`SELECT snapshot_id FROM snapshot_tags WHERE tag_id = ${id} ORDER BY snapshot_id`,
    );
    // Then each snapshot, so a concurrent tag change on it cannot rewrite its index entry
    // from a stale tag list.
    for (const { snapshot_id } of tagged) await lockSnapshot(tx, snapshot_id);
    const changes = await tx.run(sql`DELETE FROM tags WHERE id = ${id}`);
    for (const { snapshot_id } of tagged) await syncIndexTags(tx, snapshot_id);
    return changes > 0;
  });
}

export async function addTagToSnapshot(db: Db, snapshotId: number, tagId: number): Promise<void> {
  await db.transaction(async (tx) => {
    await lockSnapshot(tx, snapshotId);
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
    await lockSnapshot(tx, snapshotId);
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
