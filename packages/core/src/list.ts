import type Database from "bun:sqlite";
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
}

// Failed extractors leave a row with `error` set and no content; joining only the
// successful rows keeps them out of `extractors`, `title` and `hasScreenshot`.
const SNAPSHOT_SELECT = `SELECT s.id, s.url, s.status, s.created_at,
     GROUP_CONCAT(DISTINCT ar.extractor) AS extractor_names,
     MAX(CASE WHEN ar.extractor = 'readability' THEN ar.content END) AS readability_content,
     MAX(CASE WHEN ar.extractor = 'screenshot' THEN 1 END) AS has_screenshot
   FROM snapshots s
   LEFT JOIN archive_results ar ON ar.snapshot_id = s.id AND ar.error IS NULL`;

interface RawTagRow {
  snapshot_id: number;
  tag_id: number;
  name: string;
  slug: string;
  color: string | null;
  created_at: string;
}

/** Load tags for the given snapshots (or for every snapshot when `ids` is omitted). */
function loadTags(db: Database, ids?: number[]): Map<number, Tag[]> {
  const base = `SELECT st.snapshot_id, t.id AS tag_id, t.name, t.slug, t.color, t.created_at
     FROM snapshot_tags st
     JOIN tags t ON t.id = st.tag_id`;
  // number[] extends SQLQueryBindings[] so .all(...ids) type-checks; the dynamic
  // IN clause requires a variable param count that cannot be expressed as a fixed tuple.
  const tagRows = ids
    ? db
        .query<RawTagRow, number[]>(
          `${base} WHERE st.snapshot_id IN (${ids.map(() => "?").join(",")}) ORDER BY t.name`,
        )
        .all(...ids)
    : db.query<RawTagRow, []>(`${base} ORDER BY t.name`).all();

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
    hasScreenshot: r.has_screenshot === 1,
  };
}

export function listSnapshots(db: Database): Snapshot[] {
  return db
    .query<Snapshot, []>("SELECT id, url, status, created_at FROM snapshots ORDER BY id")
    .all();
}

export function listSnapshotsWithExtractors(db: Database): SnapshotWithExtractors[] {
  const rows = db.query<SnapshotRow, []>(`${SNAPSHOT_SELECT} GROUP BY s.id ORDER BY s.id`).all();
  // Load all snapshot-tag associations in a single query to avoid N+1
  const tags = loadTags(db);
  return rows.map((r) => toSnapshot(r, tags));
}

/**
 * Load list-level metadata (extractors, tags, title…) for specific snapshots.
 * Ids that do not exist are simply absent from the returned map.
 */
export function getSnapshotsByIds(
  db: Database,
  ids: number[],
): Map<number, SnapshotWithExtractors> {
  const result = new Map<number, SnapshotWithExtractors>();
  if (ids.length === 0) return result;
  const rows = db
    .query<SnapshotRow, number[]>(
      `${SNAPSHOT_SELECT} WHERE s.id IN (${ids.map(() => "?").join(",")}) GROUP BY s.id`,
    )
    .all(...ids);
  const tags = loadTags(db, ids);
  for (const r of rows) result.set(r.id, toSnapshot(r, tags));
  return result;
}

/**
 * One page of snapshots, newest first — page 1 is what was archived most recently,
 * which is what a "recent activity" view and the first screen of a list should show.
 */
export function listSnapshotsWithExtractorsPaginated(
  db: Database,
  page: number,
  limit: number,
  status?: string,
): PaginatedResult<SnapshotWithExtractors> {
  const offset = (page - 1) * limit;

  const countRow = status
    ? db
        .query<{ total: number }, [string]>(
          "SELECT COUNT(*) AS total FROM snapshots WHERE status = ?",
        )
        .get(status)
    : db.query<{ total: number }, []>("SELECT COUNT(*) AS total FROM snapshots").get();
  const total = countRow?.total ?? 0;

  const whereClause = status ? "WHERE s.status = ?" : "";
  const rows = db
    .query<SnapshotRow, [string, number, number] | [number, number]>(
      `${SNAPSHOT_SELECT}
       ${whereClause}
       GROUP BY s.id
       ORDER BY s.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(
      ...(status
        ? ([status, limit, offset] as [string, number, number])
        : ([limit, offset] as [number, number])),
    );

  if (rows.length === 0) {
    return { items: [], total, page, limit };
  }

  const tags = loadTags(
    db,
    rows.map((r) => r.id),
  );
  return { items: rows.map((r) => toSnapshot(r, tags)), total, page, limit };
}
