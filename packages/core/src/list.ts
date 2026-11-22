import { type RawBuilder, sql } from "kysely";
import type { Db } from "./db";
import type { Tag } from "./tags";

function parseReadability(content: string | null): {
  title: string | null;
  excerpt: string | null;
} {
  if (!content) return { title: null, excerpt: null };
  try {
    const parsed = JSON.parse(content) as { title?: string | null; excerpt?: string | null };
    const title = parsed.title ?? null;
    const fullExcerpt = parsed.excerpt ?? null;
    const excerpt = fullExcerpt ? fullExcerpt.slice(0, 120) : null;
    return { title, excerpt };
  } catch {
    return { title: null, excerpt: null };
  }
}

export interface Snapshot {
  id: number;
  url: string;
  status: string;
  created_at: string;
}

export interface SnapshotWithExtractors extends Snapshot {
  /** Extractors that produced output (failed extractors are not listed). */
  extractors: string[];
  tags: Tag[];
  title: string | null;
  excerpt: string | null;
  hasScreenshot: boolean;
  /** A small JPEG of the first screen; snapshots archived before it existed have none. */
  hasThumbnail: boolean;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

interface SnapshotRow {
  id: number;
  url: string;
  status: string;
  created_at: string;
  extractor_names: string | null;
  readability_content: string | null;
  has_screenshot: number | null;
  has_thumbnail: number | null;
}

// Failed extractors leave a row with `error` set and no content; joining only the
// successful rows keeps them out of `extractors`, `title` and `hasScreenshot`.
function snapshotSelect(db: Db): RawBuilder<SnapshotRow> {
  const names =
    db.dialect === "postgres"
      ? sql`string_agg(DISTINCT ar.extractor, ',')`
      : sql`GROUP_CONCAT(DISTINCT ar.extractor)`;
  return sql<SnapshotRow>`SELECT s.id, s.url, s.status, s.created_at,
     ${names} AS extractor_names,
     MAX(CASE WHEN ar.extractor = 'readability' THEN ar.content END) AS readability_content,
     MAX(CASE WHEN ar.extractor = 'screenshot' THEN 1 END) AS has_screenshot,
     MAX(CASE WHEN ar.extractor = 'thumbnail' THEN 1 END) AS has_thumbnail
   FROM snapshots s
   LEFT JOIN archive_results ar ON ar.snapshot_id = s.id AND ar.error IS NULL`;
}

/** GROUP BY that every dialect accepts for the columns snapshotSelect() returns. */
const SNAPSHOT_GROUP_BY = sql`GROUP BY s.id, s.url, s.status, s.created_at`;

interface RawTagRow {
  snapshot_id: number;
  tag_id: number;
  name: string;
  slug: string;
  color: string | null;
  created_at: string;
}

/** Load tags for the given snapshots (or for every snapshot when `ids` is omitted). */
async function loadTags(db: Db, ids?: number[]): Promise<Map<number, Tag[]>> {
  const base = sql`SELECT st.snapshot_id, t.id AS tag_id, t.name, t.slug, t.color, t.created_at
     FROM snapshot_tags st
     JOIN tags t ON t.id = st.tag_id`;
  const tagRows = ids
    ? await db.all<RawTagRow>(
        sql`${base} WHERE st.snapshot_id IN (${sql.join(ids)}) ORDER BY t.name, st.snapshot_id`,
      )
    : await db.all<RawTagRow>(sql`${base} ORDER BY t.name, st.snapshot_id`);

  const tagsBySnapshot = new Map<number, Tag[]>();
  for (const row of tagRows) {
    let list = tagsBySnapshot.get(row.snapshot_id);
    if (!list) {
      list = [];
      tagsBySnapshot.set(row.snapshot_id, list);
    }
    list.push({
      id: row.tag_id,
      name: row.name,
      slug: row.slug,
      color: row.color,
      created_at: row.created_at,
    });
  }
  return tagsBySnapshot;
}

function toSnapshot(r: SnapshotRow, tags: Map<number, Tag[]>): SnapshotWithExtractors {
  const { title, excerpt } = parseReadability(r.readability_content);
  return {
    id: r.id,
    url: r.url,
    status: r.status,
    created_at: r.created_at,
    extractors: r.extractor_names ? r.extractor_names.split(",") : [],
    tags: tags.get(r.id) ?? [],
    title,
    excerpt,
    hasScreenshot: Number(r.has_screenshot) === 1,
    hasThumbnail: Number(r.has_thumbnail) === 1,
  };
}

export async function listSnapshots(db: Db): Promise<Snapshot[]> {
  return db.all<Snapshot>(sql`SELECT id, url, status, created_at FROM snapshots ORDER BY id`);
}

export async function listSnapshotsWithExtractors(db: Db): Promise<SnapshotWithExtractors[]> {
  const rows = await db.all(
    sql<SnapshotRow>`${snapshotSelect(db)} ${SNAPSHOT_GROUP_BY} ORDER BY s.id`,
  );
  // Load all snapshot-tag associations in a single query to avoid N+1
  const tags = await loadTags(db);
  return rows.map((r) => toSnapshot(r, tags));
}

/**
 * Load list-level metadata (extractors, tags, title…) for specific snapshots.
 * Ids that do not exist are simply absent from the returned map.
 */
export async function getSnapshotsByIds(
  db: Db,
  ids: number[],
): Promise<Map<number, SnapshotWithExtractors>> {
  const result = new Map<number, SnapshotWithExtractors>();
  if (ids.length === 0) return result;
  const rows = await db.all(
    sql<SnapshotRow>`${snapshotSelect(db)} WHERE s.id IN (${sql.join(ids)}) ${SNAPSHOT_GROUP_BY}`,
  );
  const tags = await loadTags(db, ids);
  for (const r of rows) result.set(r.id, toSnapshot(r, tags));
  return result;
}

/**
 * One page of snapshots, newest first — page 1 is what was archived most recently,
 * which is what a "recent activity" view and the first screen of a list should show.
 */
export async function listSnapshotsWithExtractorsPaginated(
  db: Db,
  page: number,
  limit: number,
  status?: string,
): Promise<PaginatedResult<SnapshotWithExtractors>> {
  const offset = (page - 1) * limit;
  const where = status ? sql`WHERE s.status = ${status}` : sql``;

  const countRow = await db.get<{ total: number }>(
    sql`SELECT COUNT(*) AS total FROM snapshots s ${where}`,
  );
  const total = countRow?.total ?? 0;

  const rows = await db.all(
    sql<SnapshotRow>`${snapshotSelect(db)}
       ${where}
       ${SNAPSHOT_GROUP_BY}
       ORDER BY s.id DESC
       LIMIT ${limit} OFFSET ${offset}`,
  );

  if (rows.length === 0) {
    return { items: [], total, page, limit };
  }

  const tags = await loadTags(
    db,
    rows.map((r) => r.id),
  );
  return { items: rows.map((r) => toSnapshot(r, tags)), total, page, limit };
}
