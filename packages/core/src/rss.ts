/**
 * RSS/Atom feed fetching utilities.
 *
 * - fetchRssFeedUrls: fetch a feed URL and return article URLs parsed from it.
 * - isUrlArchived: check whether a URL already has a snapshot (for deduplication).
 */

import type Database from "bun:sqlite";
import { parseUrls } from "./import";
import { safeFetch } from "./ssrf-guard";

/**
 * Fetch an RSS 2.0 or Atom feed and return all article URLs found in it.
 * Uses the SSRF-safe fetcher to prevent server-side request forgery.
 */
export async function fetchRssFeedUrls(feedUrl: string): Promise<string[]> {
  const response = await safeFetch(feedUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch feed ${feedUrl}: HTTP ${response.status}`);
  }
  const content = await response.text();
  return parseUrls(content, "rss", feedUrl);
}

/**
 * Returns true if a snapshot with this exact URL already exists in the database.
 * Used to deduplicate RSS feed imports.
 */
export function isUrlArchived(db: Database, url: string): boolean {
  const row = db
    .query<{ id: number }, [string]>("SELECT id FROM snapshots WHERE url = ? LIMIT 1")
    .get(url);
  return row !== null;
}
