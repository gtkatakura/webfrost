import type Database from "bun:sqlite";
import type { PaginatedResult } from "./list";

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

// Control characters used as highlight sentinels inside SQLite, so the archived
// text can be HTML-escaped before the real <mark> tags are added.
const MARK_OPEN = "\u0001";
const MARK_CLOSE = "\u0002";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Turn a sentinel-marked FTS snippet into HTML that is safe to inject as-is. */
export function renderSnippet(raw: string): string {
  return escapeHtml(raw).replaceAll(MARK_OPEN, "<mark>").replaceAll(MARK_CLOSE, "</mark>");
}

/**
 * Add or replace the FTS index entry for a snapshot.
 * Called after a pipeline run completes so the extracted content is searchable.
 */
export function indexSnapshot(
  db: Database,
  snapshotId: number,
  url: string,
  title: string,
  textContent: string,
  tags: string,
): void {
  // Remove stale entry first (upsert via delete + insert)
  db.query<null, [number]>("DELETE FROM snapshots_fts WHERE rowid = ?").run(snapshotId);
  db.query<null, [number, string, string, string, string]>(
    "INSERT INTO snapshots_fts(rowid, url, title, text_content, tags) VALUES (?, ?, ?, ?, ?)",
  ).run(snapshotId, url, title, textContent, tags);
}

/** Remove a snapshot from the FTS index (called on deletion). */
export function removeFromIndex(db: Database, snapshotId: number): void {
  db.query<null, [number]>("DELETE FROM snapshots_fts WHERE rowid = ?").run(snapshotId);
}

/**
 * Rebuild the FTS index from scratch using current archive_results and tags.
 * Useful when upgrading an existing archive.
 */
export function rebuildIndex(db: Database): void {
  db.query("DELETE FROM snapshots_fts").run();

  interface ReadabilityRow {
    id: number;
    url: string;
    content: string | null;
  }

  const snapshots = db
    .query<ReadabilityRow, []>(
      `SELECT s.id, s.url,
         (SELECT content FROM archive_results
          WHERE snapshot_id = s.id AND extractor = 'readability' AND error IS NULL
          LIMIT 1) AS content
       FROM snapshots s
       WHERE s.status = 'done'`,
    )
    .all();

  for (const snap of snapshots) {
    const { title, textContent, tags } = extractIndexFields(db, snap.id, snap.content);
    indexSnapshot(db, snap.id, snap.url, title, textContent, tags);
  }
}

/**
 * Full-text search across URL, title, extracted text, and tags.
 * Returns paginated results ranked by relevance, with an HTML-safe snippet
 * (archived text is escaped; only <mark> highlights are real markup).
 *
 * FTS5 MATCH syntax is supported (e.g. "phrase query", term*, col:term).
 * Returns empty result on invalid query expressions.
 */
export function searchSnapshots(
  db: Database,
  query: string,
  requestedLimit = 20,
  requestedPage = 1,
  status?: string,
): PaginatedResult<SearchResult> {
  // LIMIT/OFFSET must be integers; a fractional value makes SQLite raise.
  const limit = Math.max(1, Math.trunc(requestedLimit) || 20);
  const page = Math.max(1, Math.trunc(requestedPage) || 1);
  if (!query.trim()) return { items: [], total: 0, page, limit };
  const statusFilter = status ?? null;

  interface FtsRow {
    id: number;
    url: string;
    snippet: string;
    rank: number;
  }

  const offset = (page - 1) * limit;

  try {
    const items = db
      .query<FtsRow, [string, string, string, string | null, string | null, number, number]>(
        `SELECT
           snapshots_fts.rowid AS id,
           snapshots_fts.url AS url,
           snippet(snapshots_fts, 2, ?, ?, '…', 32) AS snippet,
           rank
         FROM snapshots_fts
         JOIN snapshots s ON s.id = snapshots_fts.rowid
         WHERE snapshots_fts MATCH ?
           AND (? IS NULL OR s.status = ?)
         ORDER BY rank
         LIMIT ? OFFSET ?`,
      )
      .all(MARK_OPEN, MARK_CLOSE, query, statusFilter, statusFilter, limit, offset)
      .map((row) => ({ ...row, snippet: renderSnippet(row.snippet) }));

    const countRow = db
      .query<{ total: number }, [string, string | null, string | null]>(
        `SELECT COUNT(*) AS total
         FROM snapshots_fts
         JOIN snapshots s ON s.id = snapshots_fts.rowid
         WHERE snapshots_fts MATCH ?
           AND (? IS NULL OR s.status = ?)`,
      )
      .get(query, statusFilter, statusFilter);
    const total = countRow?.total ?? 0;

    return { items, total, page, limit };
  } catch {
    // Invalid FTS query expression — return no results instead of throwing
    return { items: [], total: 0, page, limit };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface IndexFields {
  title: string;
  textContent: string;
  tags: string;
}

export function extractIndexFields(
  db: Database,
  snapshotId: number,
  readabilityContent: string | null | undefined,
): IndexFields {
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

  const tagRows = db
    .query<{ name: string }, [number]>(
      "SELECT t.name FROM tags t JOIN snapshot_tags st ON st.tag_id = t.id WHERE st.snapshot_id = ?",
    )
    .all(snapshotId);
  const tags = tagRows.map((r) => r.name).join(" ");

  return { title, textContent, tags };
}
