/**
 * RSS/Atom feed fetching utilities.
 *
 * - fetchRssFeedUrls: fetch a feed URL and return article URLs parsed from it.
 * - isUrlArchived: check whether a URL already has a snapshot (for deduplication).
 */

import { sql } from "kysely";
import type { Db } from "./db";
import {
  ImportLimitError,
  importMaxBytes,
  importMaxUrls,
  importTooLargeMessage,
  importTooManyUrlsMessage,
  parseUrls,
} from "./import";
import { fetchGuarded } from "./ssrf-guard";

/**
 * Fetch an RSS 2.0 or Atom feed and return all article URLs found in it.
 * Uses the SSRF-safe fetcher to prevent server-side request forgery.
 *
 * The feed is held to the import limits: a body over WEBFROST_IMPORT_MAX_BYTES, or more
 * than WEBFROST_IMPORT_MAX_URLS links, throws an ImportLimitError before anything is
 * queued. Relative links resolve against the URL the feed was finally served from.
 */
export async function fetchRssFeedUrls(feedUrl: string): Promise<string[]> {
  const response = await fetchGuarded(feedUrl);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Failed to fetch feed ${feedUrl}: HTTP ${response.status}`);
  }
  if (response.body.byteLength > importMaxBytes()) {
    throw new ImportLimitError("bytes", importTooLargeMessage());
  }
  const content = new TextDecoder().decode(response.body);
  const max = importMaxUrls();
  const urls = parseUrls(content, "rss", response.url, { maxUrls: max });
  if (urls.length > max) throw new ImportLimitError("urls", importTooManyUrlsMessage(urls.length));
  return urls;
}

/**
 * Returns true if a snapshot with this exact URL already exists in the database.
 * Used to deduplicate RSS feed imports.
 */
export async function isUrlArchived(db: Db, url: string): Promise<boolean> {
  const row = await db.get<{ id: number }>(
    sql`SELECT id FROM snapshots WHERE url = ${url} LIMIT 1`,
  );
  return row !== null;
}
