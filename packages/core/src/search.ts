import { sql } from "kysely";
import type { Db } from "./db";
import { type PaginatedResult, pageWindow } from "./list";
import {
  MARK_CLOSE,
  MARK_OPEN,
  MAX_SNIPPET_SOURCE,
  buildSnippet,
  capForTsvector,
  parseSearchQuery,
  searchDocument,
  toMysqlBoolean,
  toTsquery,
} from "./search-text";

/**
 * Full-text search over URL, title, extracted text and tag names.
 *
 * One interface, three engines:
 * - SQLite: the FTS5 table `snapshots_fts` (unchanged), ranked by bm25, snippets
 *   from FTS5's snippet() — the full FTS5 query syntax is available.
 * - PostgreSQL: `search_index.search_vector` (tsvector, GIN index), ranked by
 *   ts_rank.
 * - MySQL: a FULLTEXT index on `search_index.search_text`, boolean mode.
 *
 * PostgreSQL and MySQL index a normalised token stream built in app code (see
 * search-text.ts) so tokenisation matches FTS5, accept the common FTS5 syntax
 * (words, "phrases", prefix*, OR, NOT/-word) and build snippets in app code with
 * the same 32-token window. On every engine `rank` sorts ascending — lower is a
 * better match — and the snippet is HTML-safe with `<mark>` around hits.
 */
export interface SearchResult {
  id: number;
  url: string;
  /**
   * HTML-safe excerpt: the archived text is entity-escaped and the only markup
   * is `<mark>…</mark>` around matched terms.
   */
  snippet: string;
  rank: number;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Turn a sentinel-marked snippet into HTML that is safe to inject as-is. */
export function renderSnippet(raw: string): string {
  return escapeHtml(raw).replaceAll(MARK_OPEN, "<mark>").replaceAll(MARK_CLOSE, "</mark>");
}

interface IndexEntry {
  url: string;
  title: string;
  textContent: string;
  tags: string;
}

function searchText(db: Db, entry: IndexEntry): string {
  const tokens = searchDocument([entry.url, entry.title, entry.textContent, entry.tags]);
  return (db.dialect === "postgres" ? capForTsvector(tokens) : tokens).join(" ");
}

async function writeEntry(db: Db, snapshotId: number, entry: IndexEntry): Promise<void> {
  if (db.dialect === "sqlite") {
    // Remove stale entry first (upsert via delete + insert)
    await db.run(sql`DELETE FROM snapshots_fts WHERE rowid = ${snapshotId}`);
    await db.run(
      sql`INSERT INTO snapshots_fts(rowid, url, title, text_content, tags) VALUES (${snapshotId}, ${entry.url}, ${entry.title}, ${entry.textContent}, ${entry.tags})`,
    );
    return;
  }
  await db.run(sql`DELETE FROM search_index WHERE snapshot_id = ${snapshotId}`);
  await db.run(
    sql`INSERT INTO search_index (snapshot_id, url, title, text_content, tags, search_text) VALUES (${snapshotId}, ${entry.url}, ${entry.title}, ${entry.textContent}, ${entry.tags}, ${searchText(db, entry)})`,
  );
}

/**
 * Add or replace the full-text index entry for a snapshot.
 * Called after a pipeline run completes so the extracted content is searchable.
 */
export async function indexSnapshot(
  db: Db,
  snapshotId: number,
  url: string,
  title: string,
  textContent: string,
  tags: string,
): Promise<void> {
  await db.transaction((tx) => writeEntry(tx, snapshotId, { url, title, textContent, tags }));
}

/** Remove a snapshot from the full-text index (called on deletion). */
export async function removeFromIndex(db: Db, snapshotId: number): Promise<void> {
  if (db.dialect === "sqlite") {
    await db.run(sql`DELETE FROM snapshots_fts WHERE rowid = ${snapshotId}`);
  } else {
    await db.run(sql`DELETE FROM search_index WHERE snapshot_id = ${snapshotId}`);
  }
}

/**
 * Rewrite the tag names of an indexed snapshot. A snapshot that is not indexed
 * yet is left alone — the pipeline indexes it, tags included, when it finishes.
 */
export async function updateIndexedTags(db: Db, snapshotId: number, tags: string): Promise<void> {
  if (db.dialect === "sqlite") {
    await db.run(sql`UPDATE snapshots_fts SET tags = ${tags} WHERE rowid = ${snapshotId}`);
    return;
  }
  await db.transaction(async (tx) => {
    const row = await tx.get<{ url: string; title: string; text_content: string }>(
      sql`SELECT url, title, text_content FROM search_index WHERE snapshot_id = ${snapshotId} ${tx.forShare()}`,
    );
    if (!row) return;
    const entry = { url: row.url, title: row.title, textContent: row.text_content, tags };
    await tx.run(
      sql`UPDATE search_index SET tags = ${tags}, search_text = ${searchText(tx, entry)} WHERE snapshot_id = ${snapshotId}`,
    );
  });
}

/**
 * Rebuild the full-text index from scratch using current archive_results and
 * tags, in one transaction: searches see either the old index or the new one.
 * Useful when upgrading an existing archive.
 */
export async function rebuildIndex(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run(
      tx.dialect === "sqlite" ? sql`DELETE FROM snapshots_fts` : sql`DELETE FROM search_index`,
    );

    const snapshots = await tx.all<{ id: number; url: string; content: string | null }>(
      sql`SELECT s.id, s.url,
            (SELECT content FROM archive_results
             WHERE snapshot_id = s.id AND extractor = 'readability' AND error IS NULL
             ORDER BY id LIMIT 1) AS content
          FROM snapshots s
          WHERE s.status = 'done'
          ORDER BY s.id`,
    );

    for (const snap of snapshots) {
      const { title, textContent, tags } = await extractIndexFields(tx, snap.id, snap.content);
      await writeEntry(tx, snap.id, { url: snap.url, title, textContent, tags });
    }
  });
}

interface HitRow {
  id: number;
  url: string;
  snippet: string;
  score: number;
}

/** SQLite rejects a malformed MATCH expression with one of these messages. */
function isFts5QueryError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /fts5|syntax error|unterminated string|no such column|malformed MATCH/i.test(message);
}

/**
 * Full-text search across URL, title, extracted text, and tags.
 * Returns paginated results ranked by relevance, with an HTML-safe snippet
 * (archived text is escaped; only <mark> highlights are real markup).
 *
 * On SQLite the FTS5 MATCH syntax is supported (e.g. "phrase query", term*,
 * col:term); PostgreSQL and MySQL accept its common subset (see search-text.ts).
 * Returns an empty result on invalid query expressions.
 */
export async function searchSnapshots(
  db: Db,
  query: string,
  requestedLimit = 20,
  requestedPage = 1,
  status?: string,
): Promise<PaginatedResult<SearchResult>> {
  // LIMIT/OFFSET must be integers the database can hold (not Infinity, not a fraction).
  const { page, limit, offset } = pageWindow(requestedPage, requestedLimit);
  const empty = { items: [], total: 0, page, limit };
  if (!query.trim()) return empty;
  const statusFilter = status ? sql`AND s.status = ${status}` : sql``;

  if (db.dialect === "sqlite") {
    try {
      const items = await db.all<HitRow>(
        sql`SELECT
              snapshots_fts.rowid AS id,
              snapshots_fts.url AS url,
              snippet(snapshots_fts, 2, ${MARK_OPEN}, ${MARK_CLOSE}, '…', 32) AS snippet,
              rank AS score
            FROM snapshots_fts
            JOIN snapshots s ON s.id = snapshots_fts.rowid
            WHERE snapshots_fts MATCH ${query}
              ${statusFilter}
            ORDER BY rank
            LIMIT ${limit} OFFSET ${offset}`,
      );
      const count = await db.get<{ total: number }>(
        sql`SELECT COUNT(*) AS total
            FROM snapshots_fts
            JOIN snapshots s ON s.id = snapshots_fts.rowid
            WHERE snapshots_fts MATCH ${query}
              ${statusFilter}`,
      );
      return {
        items: items.map((r) => ({
          id: r.id,
          url: r.url,
          snippet: renderSnippet(r.snippet),
          rank: r.score,
        })),
        total: count?.total ?? 0,
        page,
        limit,
      };
    } catch (err) {
      // An invalid FTS5 query expression is "no results"; a busy, corrupt or
      // missing database is a real error and must not look like an empty search.
      if (isFts5QueryError(err)) return empty;
      throw err;
    }
  }

  // The query is parsed in app code, so an error here is a real database error.
  const clauses = parseSearchQuery(query);
  if (clauses.length === 0) return empty;

  // `score` is "higher is better" on both engines; it is negated below so `rank`
  // keeps FTS5's "lower is better" meaning for API clients.
  let match: ReturnType<typeof sql>;
  let score: ReturnType<typeof sql>;
  let from: ReturnType<typeof sql>;
  if (db.dialect === "postgres") {
    const tsquery = toTsquery(clauses);
    from = sql`search_index si
               JOIN snapshots s ON s.id = si.snapshot_id
               CROSS JOIN to_tsquery('simple', ${tsquery}) AS q`;
    match = sql`si.search_vector @@ q`;
    score = sql`ts_rank(si.search_vector, q)`;
  } else {
    const against = toMysqlBoolean(clauses);
    from = sql`search_index si JOIN snapshots s ON s.id = si.snapshot_id`;
    match = sql`MATCH (si.search_text) AGAINST (${against} IN BOOLEAN MODE)`;
    score = match;
  }

  const rows = await db.all<{ id: number; url: string; text_content: string; score: number }>(
    sql`SELECT si.snapshot_id AS id, si.url AS url, left(si.text_content, ${sql.lit(MAX_SNIPPET_SOURCE)}) AS text_content, ${score} AS score
        FROM ${from}
        WHERE ${match} ${statusFilter}
        ORDER BY score DESC, si.snapshot_id
        LIMIT ${limit} OFFSET ${offset}`,
  );
  const count = await db.get<{ total: number }>(
    sql`SELECT COUNT(*) AS total FROM ${from} WHERE ${match} ${statusFilter}`,
  );
  return {
    items: rows.map((r) => ({
      id: Number(r.id),
      url: r.url,
      snippet: renderSnippet(buildSnippet(r.text_content, clauses)),
      rank: -Number(r.score),
    })),
    total: Number(count?.total ?? 0),
    page,
    limit,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface IndexFields {
  title: string;
  textContent: string;
  tags: string;
}

export async function extractIndexFields(
  db: Db,
  snapshotId: number,
  readabilityContent: string | null | undefined,
): Promise<IndexFields> {
  let title = "";
  let textContent = "";

  if (readabilityContent) {
    try {
      const parsed = JSON.parse(readabilityContent) as {
        title?: string | null;
        textContent?: string | null;
      };
      title = parsed.title ?? "";
      textContent = parsed.textContent ?? "";
    } catch {
      // malformed JSON — skip
    }
  }

  const tagRows = await db.all<{ name: string }>(
    sql`SELECT t.name FROM tags t JOIN snapshot_tags st ON st.tag_id = t.id WHERE st.snapshot_id = ${snapshotId} ORDER BY t.name`,
  );
  const tags = tagRows.map((r) => r.name).join(" ");

  return { title, textContent, tags };
}
