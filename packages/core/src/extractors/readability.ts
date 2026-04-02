import type Database from "bun:sqlite";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

interface ReadabilityResult {
  title: string | null;
  byline: string | null;
  textContent: string | null;
  excerpt: string | null;
}

export function readabilityExtractor(
  db: Database,
  snapshotId: number,
  url: string,
  html: string,
): void {
  let result: ReadabilityResult;
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    result = {
      title: article?.title ?? null,
      byline: article?.byline ?? null,
      textContent: article?.textContent ?? null,
      excerpt: article?.excerpt ?? null,
    };
  } catch {
    result = { title: null, byline: null, textContent: null, excerpt: null };
  }

  db.query<null, [number, string]>(
    "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'readability', ?)",
  ).run(snapshotId, JSON.stringify(result));
}
