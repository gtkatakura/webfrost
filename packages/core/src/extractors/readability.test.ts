import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { sql } from "kysely";
import { type Db, openDb } from "../db";
import { blockText, capHtml, plain, readabilityExtractor } from "./readability";

let testDir: string;
let db: Db;

beforeEach(async () => {
  testDir = join(tmpdir(), `readability-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = await openDb(testDir);
  await db.run(
    sql`INSERT INTO snapshots (url, status) VALUES ('https://example.com/article', 'pending')`,
  );
});

afterEach(async () => {
  await db.close();
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
  test("stores JSON result with extractor=readability for an article page", async () => {
    await readabilityExtractor(db, 1, "https://example.com/article", ARTICLE_HTML);

    const row = await db.get<{ extractor: string; content: string }>(
      sql`SELECT extractor, content FROM archive_results WHERE snapshot_id = 1 LIMIT 1`,
    );

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

  test("does not throw on a non-article page — stores best-effort or null result", async () => {
    const homepageHtml =
      "<html><head><title>Home</title></head><body><nav>links</nav></body></html>";

    await expect(
      readabilityExtractor(db, 1, "https://example.com", homepageHtml),
    ).resolves.toBeUndefined();

    const row = await db.get<{ content: string }>(
      sql`SELECT content FROM archive_results WHERE snapshot_id = 1 LIMIT 1`,
    );

    expect(row).not.toBeNull();
    // Content should be valid JSON
    expect(() => JSON.parse(row?.content ?? "{}")).not.toThrow();
  });

  test("does not throw on empty or malformed HTML", async () => {
    await expect(readabilityExtractor(db, 1, "https://example.com", "")).resolves.toBeUndefined();
  });
});

describe("readability input cap", () => {
  afterEach(async () => {
    Reflect.deleteProperty(process.env, "WEBFROST_READABILITY_MAX_BYTES");
  });

  test("capHtml cuts at a UTF-8 byte budget without splitting a character", async () => {
    expect(capHtml("short", 100)).toBe("short");
    expect(capHtml("ééé", 0)).toBe("ééé"); // 0 = no cap
    // "é" is 2 bytes: 5 bytes fit two of them, the half character is dropped.
    expect(capHtml("ééé", 5)).toBe("éé");
  });

  test("parses only the first WEBFROST_READABILITY_MAX_BYTES of a huge page", async () => {
    process.env.WEBFROST_READABILITY_MAX_BYTES = String(ARTICLE_HTML.length + 200);
    // The article, then megabytes of markup that would take JSDOM seconds to build.
    const huge = `${ARTICLE_HTML}<div>${"<p>FILLER-AFTER-CAP</p>".repeat(200_000)}</div>`;
    const start = Date.now();
    await readabilityExtractor(db, 1, "https://example.com/article", huge);
    expect(Date.now() - start).toBeLessThan(3000);

    const row = await db.get<{ content: string }>(
      sql`SELECT content FROM archive_results WHERE snapshot_id = 1`,
    );
    const parsed = JSON.parse(row?.content ?? "{}") as { textContent: string | null };
    expect(parsed.textContent).toContain("first paragraph");
    expect((parsed.textContent ?? "").split("FILLER-AFTER-CAP").length).toBeLessThan(20);
  });
});

describe("blockText", () => {
  const text = (html: string) => blockText(JSDOM.fragment(html));

  test("keeps a blank line between headings, paragraphs and list items", () => {
    expect(text("<h1>Open Source</h1><p>Keep the web</p><ul><li>one</li><li>two</li></ul>")).toBe(
      "Open Source\n\nKeep the web\n\none\n\ntwo",
    );
  });

  test("turns <br> into a newline and collapses inline whitespace", () => {
    expect(text("<p>line  one<br>line\n   two</p>")).toBe("line one\nline two");
  });

  test("keeps the whitespace of <pre>", () => {
    expect(text("<pre>a\n  b</pre>")).toBe("a\n  b");
  });

  test("drops script and style content", () => {
    expect(text("<p>hi</p><script>var x=1</script><style>p{}</style>")).toBe("hi");
  });
});

describe("readabilityExtractor: text and title", () => {
  async function stored() {
    const row = await db.get<{ content: string }>(
      sql`SELECT content FROM archive_results WHERE snapshot_id = 1 AND extractor = 'readability'`,
    );
    return JSON.parse(row?.content ?? "{}") as { title: string | null; textContent: string | null };
  }

  test("stored textContent does not run blocks together", async () => {
    const html = `<html><head><title>T</title></head><body><article>
      <h1>Open Source</h1><p>Keep the web</p>
      <p>${"Archivists keep a long memory of the web. ".repeat(20)}</p>
      <p>${"Glaciers keep a long memory of the weather. ".repeat(20)}</p>
    </article></body></html>`;
    await readabilityExtractor(db, 1, "https://example.com/a", html);
    const { textContent } = await stored();
    expect(textContent).toContain("Open Source\n\nKeep the web");
    expect(textContent).not.toContain("Open SourceKeep");
  });

  test("a page that is not an article gets its <title> as title", async () => {
    const html = `<html><head><title>  A Video Page </title></head><body><iframe src="https://example.com/embed"></iframe></body></html>`;
    await readabilityExtractor(db, 1, "https://example.com/v", html);
    expect((await stored()).title).toBe("A Video Page");
  });
});

describe("plain", () => {
  test("decodes every entity sites put in their metadata, and nbsp becomes a space", () => {
    expect(plain("what every programmer should&nbsp;know")).toBe(
      "what every programmer should know",
    );
    expect(plain("A &#8211; B &amp; C &lt;tag&gt;")).toBe("A \u2013 B & C <tag>");
    expect(plain("<b>not markup</b>")).toBe("<b>not markup</b>");
    expect(plain("   ")).toBeNull();
    expect(plain(null)).toBeNull();
  });
});
