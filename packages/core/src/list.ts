import { type RawBuilder, sql } from "kysely";
import type { Db } from "./db";
import { IMPORTING_STATUS } from "./snapshot";
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

/**
 * A page and limit the database accepts as LIMIT and OFFSET: whole numbers the
 * engine can hold (never Infinity, NaN or a fraction), with the offset kept
 * within JavaScript's exact integers. A bad value falls back to the default.
 */
export function pageWindow(
  requestedPage: number,
  requestedLimit: number,
  defaultLimit = 20,
): { page: number; limit: number; offset: number } {
  const whole = (n: number, fallback: number): number => {
    const t = Math.trunc(n);
    return Number.isSafeInteger(t) && t >= 1 ? t : fallback;
  };
  const limit = whole(requestedLimit, defaultLimit);
  const page = Math.min(whole(requestedPage, 1), Math.floor(Number.MAX_SAFE_INTEGER / limit));
  return { page, limit, offset: (page - 1) * limit };
}

export interface Snapshot {
  id: number;
  url: string;
  status: string;
  created_at: string;
}

export interface SnapshotWithExtractors extends Snapshot {
  /** Why a failed snapshot failed (a `FailureCategory`), and the message behind it. Null otherwise. */
  failure_category: string | null;
  failure_detail: string | null;
  /** When the snapshot was moved to the trash; null when it is not there. */
  trashed_at: string | null;
  /** Extractors that produced output (failed extractors are not listed). */
  extractors: string[];
  tags: Tag[];
  title: string | null;
  excerpt: string | null;
  hasScreenshot: boolean;
  /** A small JPEG of the first screen; snapshots archived before it existed have none. */
  hasThumbnail: boolean;
  /** A still from the archived video (`media-poster`), which shows a video page better than its screenshot. */
  hasPoster: boolean;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/**
 * What a list or a search keeps. Every field narrows the result, and an absent or empty one
 * does nothing.
 */
export interface SnapshotFilter {
  /** Any of these statuses. */
  statuses?: readonly string[];
  /** Created at or after this moment, in the stored form ("YYYY-MM-DD HH:MM:SS", UTC). */
  since?: string;
  /** Created before this moment, in the stored form. */
  before?: string;
  /** Every one of these extractors produced output. */
  extractors?: readonly string[];
  /** Carries every one of these tags. */
  tagIds?: readonly number[];
  /** The URL or the title contains this text, whatever the case of its ASCII letters. */
  contains?: string;
}

/** The single status older callers pass, as a filter. */
export function toSnapshotFilter(filter: SnapshotFilter | string | undefined): SnapshotFilter {
  if (filter === undefined) return {};
  return typeof filter === "string" ? (filter ? { statuses: [filter] } : {}) : filter;
}

/** `text` as a LIKE pattern that matches it anywhere, with "!" as the escape character. */
function containsPattern(text: string): string {
  return `%${text.replace(/[!%_]/g, (char) => `!${char}`)}%`;
}

/**
 * The filter as SQL conditions on `snapshots s`, each starting with AND (so it follows a WHERE
 * that already has a condition). Empty when the filter keeps everything.
 */
export function snapshotFilterSql(db: Db, filter: SnapshotFilter): RawBuilder<unknown> {
  const conditions: RawBuilder<unknown>[] = [];
  if (filter.statuses?.length) {
    conditions.push(sql`AND s.status IN (${sql.join([...filter.statuses])})`);
  }
  if (filter.since) conditions.push(sql`AND s.created_at >= ${filter.since}`);
  if (filter.before) conditions.push(sql`AND s.created_at < ${filter.before}`);
  for (const extractor of filter.extractors ?? []) {
    conditions.push(
      sql`AND EXISTS (SELECT 1 FROM archive_results fe
                      WHERE fe.snapshot_id = s.id AND fe.extractor = ${extractor} AND fe.error IS NULL)`,
    );
  }
  for (const tagId of filter.tagIds ?? []) {
    conditions.push(
      sql`AND EXISTS (SELECT 1 FROM snapshot_tags ft
                      WHERE ft.snapshot_id = s.id AND ft.tag_id = ${tagId})`,
    );
  }
  const text = filter.contains?.trim();
  if (text) {
    const pattern = containsPattern(text);
    // The title lives in the search index (a page has one once Readability has read it), so a
    // snapshot that is not indexed is matched by its URL alone.
    const title =
      db.dialect === "sqlite"
        ? sql`SELECT 1 FROM snapshots_fts fi
              WHERE fi.rowid = s.id AND lower(fi.title) LIKE lower(${pattern}) ESCAPE '!'`
        : sql`SELECT 1 FROM search_index fi
              WHERE fi.snapshot_id = s.id AND lower(fi.title) LIKE lower(${pattern}) ESCAPE '!'`;
    conditions.push(sql`AND (lower(s.url) LIKE lower(${pattern}) ESCAPE '!' OR EXISTS (${title}))`);
  }
  return conditions.length > 0 ? sql.join(conditions, sql` `) : sql``;
}

interface SnapshotRow {
  id: number;
  url: string;
  status: string;
  created_at: string;
  failure_category: string | null;
  failure_detail: string | null;
  trashed_at: string | null;
  extractor_names: string | null;
  readability_content: string | null;
  has_screenshot: number | null;
  has_thumbnail: number | null;
  has_poster: number | null;
}

// Failed extractors leave a row with `error` set and no content; joining only the
// successful rows keeps them out of `extractors`, `title` and `hasScreenshot`.
function snapshotSelect(db: Db): RawBuilder<SnapshotRow> {
  const names =
    db.dialect === "postgres"
      ? sql`string_agg(DISTINCT ar.extractor, ',')`
      : sql`GROUP_CONCAT(DISTINCT ar.extractor)`;
  return sql<SnapshotRow>`SELECT s.id, s.url, s.status, s.created_at, s.failure_category, s.failure_detail, s.trashed_at,
     ${names} AS extractor_names,
     MAX(CASE WHEN ar.extractor = 'readability' THEN ar.content END) AS readability_content,
     MAX(CASE WHEN ar.extractor = 'screenshot' THEN 1 END) AS has_screenshot,
     MAX(CASE WHEN ar.extractor = 'thumbnail' THEN 1 END) AS has_thumbnail,
     MAX(CASE WHEN ar.extractor = 'media-poster' THEN 1 END) AS has_poster
   FROM snapshots s
   LEFT JOIN archive_results ar ON ar.snapshot_id = s.id AND ar.error IS NULL`;
}

/** GROUP BY that every dialect accepts for the columns snapshotSelect() returns. */
const SNAPSHOT_GROUP_BY = sql`GROUP BY s.id, s.url, s.status, s.created_at, s.failure_category, s.failure_detail, s.trashed_at`;

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
    failure_category: r.failure_category ?? null,
    failure_detail: r.failure_detail ?? null,
    trashed_at: r.trashed_at ?? null,
    extractors: r.extractor_names ? r.extractor_names.split(",") : [],
    tags: tags.get(r.id) ?? [],
    title,
    excerpt,
    hasScreenshot: Number(r.has_screenshot) === 1,
    hasThumbnail: Number(r.has_thumbnail) === 1,
    hasPoster: Number(r.has_poster) === 1,
  };
}

export async function listSnapshots(db: Db): Promise<Snapshot[]> {
  return db.all<Snapshot>(
    sql`SELECT id, url, status, created_at FROM snapshots WHERE status <> ${IMPORTING_STATUS} AND trashed_at IS NULL ORDER BY id`,
  );
}

export async function listSnapshotsWithExtractors(db: Db): Promise<SnapshotWithExtractors[]> {
  const rows = await db.all(
    sql<SnapshotRow>`${snapshotSelect(db)} WHERE s.status <> ${IMPORTING_STATUS} AND s.trashed_at IS NULL ${SNAPSHOT_GROUP_BY} ORDER BY s.id`,
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
    sql<SnapshotRow>`${snapshotSelect(db)} WHERE s.id IN (${sql.join(ids)}) AND s.status <> ${IMPORTING_STATUS} ${SNAPSHOT_GROUP_BY}`,
  );
  const tags = await loadTags(db, ids);
  for (const r of rows) result.set(r.id, toSnapshot(r, tags));
  return result;
}

/**
 * One page of snapshots, newest first — page 1 is what was archived most recently,
 * which is what a "recent activity" view and the first screen of a list should show.
 * `filter` narrows the whole list, not the page: a status alone, or a {@link SnapshotFilter}.
 */
export async function listSnapshotsWithExtractorsPaginated(
  db: Db,
  requestedPage: number,
  requestedLimit: number,
  filter?: SnapshotFilter | string,
): Promise<PaginatedResult<SnapshotWithExtractors>> {
  const { page, limit, offset } = pageWindow(requestedPage, requestedLimit);
  // Snapshots still being imported are not shown until their files are in place.
  const where = sql`WHERE s.status <> ${IMPORTING_STATUS} AND s.trashed_at IS NULL ${snapshotFilterSql(db, toSnapshotFilter(filter))}`;

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
