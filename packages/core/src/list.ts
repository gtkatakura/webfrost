import type Database from "bun:sqlite";
import type { Tag } from "./tags";

export interface Snapshot {
  id: number;
  url: string;
  status: string;
  created_at: string;
}

export interface SnapshotWithExtractors extends Snapshot {
  extractors: string[];
  tags: Tag[];
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export function listSnapshots(db: Database): Snapshot[] {
  return db
    .query<Snapshot, []>("SELECT id, url, status, created_at FROM snapshots ORDER BY id")
    .all();
}

export function listSnapshotsWithExtractors(db: Database): SnapshotWithExtractors[] {
  const rows = db
    .query<
      {
        id: number;
        url: string;
        status: string;
        created_at: string;
        extractor_names: string | null;
      },
      []
    >(
      `SELECT s.id, s.url, s.status, s.created_at,
         GROUP_CONCAT(DISTINCT ar.extractor) AS extractor_names
       FROM snapshots s
       LEFT JOIN archive_results ar ON ar.snapshot_id = s.id
       GROUP BY s.id
       ORDER BY s.id`,
    )
    .all();

  // Load all snapshot-tag associations in a single query to avoid N+1
  const tagRows = db
    .query<
      {
        snapshot_id: number;
        tag_id: number;
        name: string;
        slug: string;
        color: string | null;
        created_at: string;
      },
      []
    >(
      `SELECT st.snapshot_id, t.id AS tag_id, t.name, t.slug, t.color, t.created_at
       FROM snapshot_tags st
       JOIN tags t ON t.id = st.tag_id
       ORDER BY t.name`,
    )
    .all();

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

  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    status: r.status,
    created_at: r.created_at,
    extractors: r.extractor_names ? r.extractor_names.split(",") : [],
    tags: tagsBySnapshot.get(r.id) ?? [],
  }));
}

export function listSnapshotsWithExtractorsPaginated(
  db: Database,
  page: number,
  limit: number,
): PaginatedResult<SnapshotWithExtractors> {
  const offset = (page - 1) * limit;

  const countRow = db.query<{ total: number }, []>("SELECT COUNT(*) AS total FROM snapshots").get();
  const total = countRow?.total ?? 0;

  const rows = db
    .query<
      {
        id: number;
        url: string;
        status: string;
        created_at: string;
        extractor_names: string | null;
      },
      [number, number]
    >(
      `SELECT s.id, s.url, s.status, s.created_at,
         GROUP_CONCAT(DISTINCT ar.extractor) AS extractor_names
       FROM snapshots s
       LEFT JOIN archive_results ar ON ar.snapshot_id = s.id
       GROUP BY s.id
       ORDER BY s.id
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset);

  if (rows.length === 0) {
    return { items: [], total, page, limit };
  }

  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");

  interface RawTagRow {
    snapshot_id: number;
    tag_id: number;
    name: string;
    slug: string;
    color: string | null;
    created_at: string;
  }

  // number[] extends SQLQueryBindings[] so .all(...ids) type-checks; the dynamic
  // IN clause requires a variable param count that cannot be expressed as a fixed tuple.
  const tagRows = db
    .query<RawTagRow, number[]>(
      `SELECT st.snapshot_id, t.id AS tag_id, t.name, t.slug, t.color, t.created_at
       FROM snapshot_tags st
       JOIN tags t ON t.id = st.tag_id
       WHERE st.snapshot_id IN (${placeholders})
       ORDER BY t.name`,
    )
    .all(...ids);

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

  const items = rows.map((r) => ({
    id: r.id,
    url: r.url,
    status: r.status,
    created_at: r.created_at,
    extractors: r.extractor_names ? r.extractor_names.split(",") : [],
    tags: tagsBySnapshot.get(r.id) ?? [],
  }));

  return { items, total, page, limit };
}
