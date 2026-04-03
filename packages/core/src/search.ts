import type Database from "bun:sqlite";
import type { PaginatedResult } from "./list";

export interface SearchResult {
  id: number;
  url: string;
  snippet: string;
  rank: number;
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
          WHERE snapshot_id = s.id AND extractor = 'readability' LIMIT 1) AS content
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
 * Returns paginated results ranked by relevance, with a plain-text snippet.
 *
 * FTS5 MATCH syntax is supported (e.g. "phrase query", term*, col:term).
 * Returns empty result on invalid query expressions.
 */
export function searchSnapshots(
  db: Database,
  query: string,
  limit = 20,
  page = 1,
): PaginatedResult<SearchResult> {
  if (!query.trim()) return { items: [], total: 0, page, limit };

  interface FtsRow {
    id: number;
    url: string;
    snippet: string;
    rank: number;
  }

  const offset = (page - 1) * limit;

  try {
    const items = db
      .query<FtsRow, [string, number, number]>(
        `SELECT
           snapshots_fts.rowid AS id,
           snapshots_fts.url AS url,
           snippet(snapshots_fts, 2, '<mark>', '</mark>', '…', 32) AS snippet,
           rank
         FROM snapshots_fts
         WHERE snapshots_fts MATCH ?
         ORDER BY rank
         LIMIT ? OFFSET ?`,
      )
      .all(query, limit, offset);

    const countRow = db
      .query<{ total: number }, [string]>(
        "SELECT COUNT(*) AS total FROM snapshots_fts WHERE snapshots_fts MATCH ?",
      )
      .get(query);
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
