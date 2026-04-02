import { describe, expect, test } from "bun:test";
import { detectFormat, parseUrls } from "./import";

describe("detectFormat", () => {
  test("detects opml by extension", () => {
    expect(detectFormat("feeds.opml", "")).toBe("opml");
  });

  test("detects netscape by .html extension + DOCTYPE marker", () => {
    expect(detectFormat("bookmarks.html", "<!DOCTYPE NETSCAPE-Bookmark-file-1>")).toBe("netscape");
  });

  test("falls back to text for plain .txt file", () => {
    expect(detectFormat("urls.txt", "https://example.com")).toBe("text");
  });

  test("falls back to text for .html without Netscape marker", () => {
    expect(detectFormat("page.html", "<html><body>hello</body></html>")).toBe("text");
  });
});

describe("parseUrls — text format", () => {
  test("extracts valid http/https URLs one per line", () => {
    const content = "https://example.com\nhttps://other.com\n";
    expect(parseUrls(content, "text")).toEqual(["https://example.com", "https://other.com"]);
  });

  test("skips blank lines and # comments", () => {
    const content = "\n# comment\nhttps://example.com\n\n";
    expect(parseUrls(content, "text")).toEqual(["https://example.com"]);
  });

  test("skips non-URL lines", () => {
    const content = "not-a-url\nhttps://valid.com";
    expect(parseUrls(content, "text")).toEqual(["https://valid.com"]);
  });

  test("skips non-http/https schemes", () => {
    const content = "ftp://example.com\nhttps://good.com";
    expect(parseUrls(content, "text")).toEqual(["https://good.com"]);
  });
});

describe("parseUrls — opml format", () => {
  const opml = `<?xml version="1.0"?>
<opml version="2.0">
  <body>
    <outline text="Tech" title="Tech">
      <outline type="rss" text="Example Feed" xmlUrl="https://example.com/feed.rss" htmlUrl="https://example.com"/>
      <outline type="rss" text="Other Feed" xmlUrl="https://other.com/atom.xml"/>
    </outline>
  </body>
</opml>`;

  test("extracts xmlUrl attributes", () => {
    const urls = parseUrls(opml, "opml");
    expect(urls).toContain("https://example.com/feed.rss");
    expect(urls).toContain("https://other.com/atom.xml");
  });

  test("does not duplicate htmlUrl if xmlUrl already present", () => {
    const urls = parseUrls(opml, "opml");
    // https://example.com appears as htmlUrl — should only be added if not already via xmlUrl
    const count = urls.filter((u) => u === "https://example.com").length;
    expect(count).toBeLessThanOrEqual(1);
  });

  test("returns empty array for empty OPML body", () => {
    const empty = "<opml><body></body></opml>";
    expect(parseUrls(empty, "opml")).toEqual([]);
  });
});

describe("parseUrls — netscape format", () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<html><body>
<DL>
  <DT><A HREF="https://example.com" ADD_DATE="1234567">Example</A>
  <DT><A HREF="https://other.com">Other</A>
  <DT><A HREF="javascript:void(0)">JS link</A>
  <DT><A HREF="ftp://files.com">FTP</A>
</DL>
</body></html>`;

  test("extracts http/https hrefs", () => {
    const urls = parseUrls(html, "netscape");
    expect(urls).toContain("https://example.com");
    expect(urls).toContain("https://other.com");
  });

  test("skips javascript: and ftp: hrefs", () => {
    const urls = parseUrls(html, "netscape");
    expect(urls.some((u) => u.startsWith("javascript:"))).toBe(false);
    expect(urls.some((u) => u.startsWith("ftp:"))).toBe(false);
  });

  test("returns empty array when no links", () => {
    expect(parseUrls("<html><body></body></html>", "netscape")).toEqual([]);
  });
});
