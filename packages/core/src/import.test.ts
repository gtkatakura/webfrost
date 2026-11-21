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

const RSS2_FEED = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example Feed</title>
    <item>
      <title>Article One</title>
      <link>https://example.com/article-1</link>
    </item>
    <item>
      <title>Article Two</title>
      <link>https://example.com/article-2</link>
    </item>
    <item>
      <title>No link item</title>
    </item>
    <item>
      <title>FTP link — should be skipped</title>
      <link>ftp://example.com/file</link>
    </item>
  </channel>
</rss>`;

const ATOM_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>Post One</title>
    <link href="https://atom.example.com/post-1" rel="alternate"/>
  </entry>
  <entry>
    <title>Post Two</title>
    <link href="https://atom.example.com/post-2"/>
  </entry>
</feed>`;

describe("detectFormat — RSS/Atom", () => {
  test("detects .rss extension", () => {
    expect(detectFormat("feed.rss", "")).toBe("rss");
  });

  test("detects .atom extension", () => {
    expect(detectFormat("feed.atom", "")).toBe("rss");
  });

  test("detects .xml with RSS content", () => {
    expect(detectFormat("feed.xml", RSS2_FEED)).toBe("rss");
  });

  test("detects RSS content without extension (content-based)", () => {
    expect(detectFormat("unknown", RSS2_FEED)).toBe("rss");
  });

  test("detects Atom content via xmlns", () => {
    expect(detectFormat("feed.xml", ATOM_FEED)).toBe("rss");
  });

  test("does not misidentify plain text as rss", () => {
    expect(detectFormat("urls.txt", "https://example.com\nhttps://other.com")).toBe("text");
  });
});

describe("parseUrls — rss format (RSS 2.0)", () => {
  test("extracts item link URLs", () => {
    const urls = parseUrls(RSS2_FEED, "rss");
    expect(urls).toContain("https://example.com/article-1");
    expect(urls).toContain("https://example.com/article-2");
  });

  test("skips items with no link", () => {
    const urls = parseUrls(RSS2_FEED, "rss");
    expect(urls).toHaveLength(2);
  });

  test("skips non-http/https links", () => {
    const urls = parseUrls(RSS2_FEED, "rss");
    expect(urls.some((u) => u.startsWith("ftp:"))).toBe(false);
  });

  test("deduplicates repeated URLs", () => {
    const feed =
      "<rss><channel><item><link>https://dup.com/a</link></item><item><link>https://dup.com/a</link></item></channel></rss>";
    const urls = parseUrls(feed, "rss");
    expect(urls.filter((u) => u === "https://dup.com/a")).toHaveLength(1);
  });

  test("returns empty array for empty feed", () => {
    expect(parseUrls("<rss><channel></channel></rss>", "rss")).toEqual([]);
  });
});

describe("parseUrls — rss format (Atom)", () => {
  test("extracts entry link hrefs", () => {
    const urls = parseUrls(ATOM_FEED, "rss");
    expect(urls).toContain("https://atom.example.com/post-1");
    expect(urls).toContain("https://atom.example.com/post-2");
  });

  test("prefers rel=alternate links", () => {
    const feed = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <link href="https://example.com/self" rel="self"/>
        <link href="https://example.com/article" rel="alternate"/>
      </entry>
    </feed>`;
    const urls = parseUrls(feed, "rss");
    expect(urls).toContain("https://example.com/article");
    expect(urls).not.toContain("https://example.com/self");
  });
});

describe("parseUrls — entities and relative links", () => {
  test("decodes &amp; and numeric references in RSS links", () => {
    const rss = `<rss><channel>
      <item><link>https://example.com/a?x=1&amp;y=2</link></item>
      <item><link>https://example.com/b?x=1&#38;y=&#x32;</link></item>
      <item><link><![CDATA[https://example.com/c?x=1&amp;y=2]]></link></item>
    </channel></rss>`;
    expect(parseUrls(rss, "rss")).toEqual([
      "https://example.com/a?x=1&y=2",
      "https://example.com/b?x=1&y=2",
      // CDATA content is literal: &amp; there really is "&amp;".
      "https://example.com/c?x=1&amp;y=2",
    ]);
  });

  test("decodes entities in Atom hrefs and resolves relative ones against the feed URL", () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry><link href="/posts/1?a=1&amp;b=2"/></entry>
      <entry><link rel="alternate" href="posts/2"/></entry>
      <entry><link href='https://other.example/3'/></entry>
    </feed>`;
    expect(parseUrls(atom, "rss", "https://blog.example/feed.xml")).toEqual([
      "https://blog.example/posts/1?a=1&b=2",
      "https://blog.example/posts/2",
      "https://other.example/3",
    ]);
  });

  test("uses xml:base, then the rel=self link, when there is no feed URL", () => {
    const withBase = `<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://base.example/blog/">
      <entry><link href="post-1"/></entry></feed>`;
    expect(parseUrls(withBase, "rss")).toEqual(["https://base.example/blog/post-1"]);

    const withSelf = `<feed xmlns="http://www.w3.org/2005/Atom">
      <link rel="self" href="https://self.example/feed.atom"/>
      <entry><link href="/p/1"/></entry></feed>`;
    expect(parseUrls(withSelf, "rss")).toEqual(["https://self.example/p/1"]);
  });

  test("a relative Atom href with no base at all is skipped", () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><link href="/p/1"/></entry></feed>`;
    expect(parseUrls(atom, "rss")).toEqual([]);
  });

  test("decodes entities in Netscape bookmarks and OPML", () => {
    const bookmarks = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL>
      <DT><A HREF="https://example.com/?q=a&amp;page=2">x</A></DL>`;
    expect(parseUrls(bookmarks, "netscape")).toEqual(["https://example.com/?q=a&page=2"]);

    const opml = `<opml><body><outline xmlUrl="https://example.com/feed?a=1&amp;b=2"/></body></opml>`;
    expect(parseUrls(opml, "opml")).toEqual(["https://example.com/feed?a=1&b=2"]);
  });
});
