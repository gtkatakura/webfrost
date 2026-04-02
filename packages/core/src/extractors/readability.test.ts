import type Database from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../db";
import { readabilityExtractor } from "./readability";

let testDir: string;
let db: Database;

beforeEach(() => {
  testDir = join(tmpdir(), `readability-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = openDb(testDir);
  db.query(
    "INSERT INTO snapshots (url, status) VALUES ('https://example.com/article', 'pending')",
  ).run();
});

afterEach(() => {
  db.close();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

const ARTICLE_HTML = `
  <html>
    <head><title>Test Article</title></head>
    <body>
      <article>
        <h1>Test Article Title</h1>
        <p class="author">By Jane Doe</p>
        <p>This is the first paragraph of the article with enough content to be detected as an article.
           It contains multiple sentences to ensure Readability can parse it properly.</p>
        <p>This is the second paragraph with more substantial content to help the parser recognize
           that this is indeed a real article worth extracting.</p>
        <p>And a third paragraph to ensure minimum content threshold is met for readability detection.</p>
      </article>
    </body>
  </html>
`;

describe("readabilityExtractor", () => {
  test("stores JSON result with extractor=readability for an article page", () => {
    readabilityExtractor(db, 1, "https://example.com/article", ARTICLE_HTML);

    const row = db
      .query<{ extractor: string; content: string }, []>(
        "SELECT extractor, content FROM archive_results WHERE snapshot_id = 1 LIMIT 1",
      )
      .get();

    expect(row).not.toBeNull();
    expect(row?.extractor).toBe("readability");

    const parsed = JSON.parse(row?.content ?? "{}") as {
      title: string | null;
      byline: string | null;
      textContent: string | null;
      excerpt: string | null;
    };
    expect(parsed.textContent).not.toBeNull();
    expect((parsed.textContent ?? "").length).toBeGreaterThan(0);
  });

  test("does not throw on a non-article page — stores best-effort or null result", () => {
    const homepageHtml =
      "<html><head><title>Home</title></head><body><nav>links</nav></body></html>";

    expect(() => {
      readabilityExtractor(db, 1, "https://example.com", homepageHtml);
    }).not.toThrow();

    const row = db
      .query<{ content: string }, []>(
        "SELECT content FROM archive_results WHERE snapshot_id = 1 LIMIT 1",
      )
      .get();

    expect(row).not.toBeNull();
    // Content should be valid JSON
    expect(() => JSON.parse(row?.content ?? "{}")).not.toThrow();
  });

  test("does not throw on empty or malformed HTML", () => {
    expect(() => {
      readabilityExtractor(db, 1, "https://example.com", "");
    }).not.toThrow();
  });
});
