import type Database from "bun:sqlite";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { envInt } from "../ssrf-guard";

/**
 * Parsing is synchronous and blocks the event loop; JSDOM on a huge page takes
 * seconds and a lot of memory. Larger inputs are cut (WEBFROST_READABILITY_MAX_BYTES).
 */
const DEFAULT_READABILITY_MAX_BYTES = 10 * 1024 * 1024;

/** Cut `html` to at most `maxBytes` of UTF-8 (0 = no cap). */
export function capHtml(html: string, maxBytes: number): string {
  // A UTF-8 character is at most 3 bytes per UTF-16 code unit: shorter strings are under the cap.
  if (maxBytes <= 0 || html.length * 3 <= maxBytes) return html;
  const bytes = new TextEncoder().encode(html);
  if (bytes.byteLength <= maxBytes) return html;
  // A character cut in half at the end decodes to U+FFFD; drop it.
  return new TextDecoder().decode(bytes.subarray(0, maxBytes)).replace(/\uFFFD$/, "");
}

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
    const input = capHtml(
      html,
      envInt("WEBFROST_READABILITY_MAX_BYTES", DEFAULT_READABILITY_MAX_BYTES),
    );
    const dom = new JSDOM(input, { url });
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
