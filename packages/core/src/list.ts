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
        readability_content: string | null;
        has_screenshot: number | null;
      },
      []
    >(
      `SELECT s.id, s.url, s.status, s.created_at,
         GROUP_CONCAT(DISTINCT ar.extractor) AS extractor_names,
         MAX(CASE WHEN ar.extractor = 'readability' THEN ar.content END) AS readability_content,
         MAX(CASE WHEN ar.extractor = 'screenshot' THEN 1 END) AS has_screenshot
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

  return rows.map((r) => {
    const { title, excerpt } = parseReadability(r.readability_content);
    return {
      id: r.id,
      url: r.url,
      status: r.status,
      created_at: r.created_at,
      extractors: r.extractor_names ? r.extractor_names.split(",") : [],
      tags: tagsBySnapshot.get(r.id) ?? [],
      title,
      excerpt,
      hasScreenshot: r.has_screenshot === 1,
    };
  });
}

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
    .query<
      {
        id: number;
        url: string;
        status: string;
        created_at: string;
        extractor_names: string | null;
        readability_content: string | null;
        has_screenshot: number | null;
      },
      [string, number, number] | [number, number]
    >(
      `SELECT s.id, s.url, s.status, s.created_at,
         GROUP_CONCAT(DISTINCT ar.extractor) AS extractor_names,
         MAX(CASE WHEN ar.extractor = 'readability' THEN ar.content END) AS readability_content,
         MAX(CASE WHEN ar.extractor = 'screenshot' THEN 1 END) AS has_screenshot
       FROM snapshots s
       LEFT JOIN archive_results ar ON ar.snapshot_id = s.id
       ${whereClause}
       GROUP BY s.id
       ORDER BY s.id
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

  const items = rows.map((r) => {
    const { title, excerpt } = parseReadability(r.readability_content);
    return {
      id: r.id,
      url: r.url,
      status: r.status,
      created_at: r.created_at,
      extractors: r.extractor_names ? r.extractor_names.split(",") : [],
      tags: tagsBySnapshot.get(r.id) ?? [],
      title,
      excerpt,
      hasScreenshot: r.has_screenshot === 1,
    };
  });

  return { items, total, page, limit };
}
