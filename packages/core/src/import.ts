/**
 * Bulk URL import — detects format and extracts URLs from:
 *   - Plain text (one URL per line)
 *   - OPML (xmlUrl attributes on <outline> elements)
 *   - Netscape bookmark HTML (<a href=...> elements)
 */

export type ImportFormat = "text" | "opml" | "netscape" | "rss";

/** Returns true if `content` looks like an RSS 2.0 or Atom feed. */
function isRssContent(content: string): boolean {
  const trimmed = content.trimStart();
  return (
    trimmed.startsWith("<rss") ||
    (trimmed.startsWith("<?xml") &&
      (content.includes("<rss ") ||
        content.includes("<rss\n") ||
        content.includes("<feed ") ||
        content.includes("<feed\n"))) ||
    content.includes('xmlns="http://www.w3.org/2005/Atom"')
  );
}

/** Detect the format from filename and/or content. */
export function detectFormat(filename: string, content: string): ImportFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".opml")) return "opml";
  if (lower.endsWith(".rss") || lower.endsWith(".atom")) return "rss";
  if (lower.endsWith(".xml") && isRssContent(content)) return "rss";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    // Netscape bookmarks contain the DOCTYPE marker
    if (content.includes("NETSCAPE-Bookmark-file") || content.includes("netscape-bookmark-file")) {
      return "netscape";
    }
  }
  // Content-based fallback: detect RSS/Atom even without a recognizable extension
  if (isRssContent(content)) return "rss";
  return "text";
}

function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Extract URLs from plain text (one URL per line, blank lines ignored). */
function parseTextUrls(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .filter((line) => isHttpUrl(line));
}

/** Extract URLs from OPML — reads xmlUrl attributes on all <outline> elements. */
function parseOpmlUrls(content: string): string[] {
  const urls: string[] = [];

  for (const match of content.matchAll(/<outline\b[^>]*\bxmlUrl\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const url = match[1]?.trim();
    if (url && isHttpUrl(url) && !urls.includes(url)) urls.push(url);
  }

  // Also pick up htmlUrl if not already added via xmlUrl
  for (const match of content.matchAll(/<outline\b[^>]*\bhtmlUrl\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const url = match[1]?.trim();
    if (url && isHttpUrl(url) && !urls.includes(url)) urls.push(url);
  }

  return urls;
}

/** Extract URLs from a Netscape bookmark HTML file (<a href=...>). */
function parseNetscapeUrls(content: string): string[] {
  const urls: string[] = [];
  for (const match of content.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const url = match[1]?.trim();
    if (url && isHttpUrl(url) && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

/** Extract article URLs from an RSS 2.0 or Atom feed. */
function parseRssUrls(content: string): string[] {
  const urls: string[] = [];

  // RSS 2.0: <item> ... <link>url</link> ... </item>
  // The <link> element in RSS may contain a CDATA section or plain text.
  for (const itemMatch of content.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const itemContent = itemMatch[1] ?? "";
    const linkMatch = itemContent.match(/<link>\s*(?:<!\[CDATA\[)?\s*(https?:\/\/[^\]<\s]+)/i);
    if (linkMatch?.[1]) {
      const url = linkMatch[1].trim();
      if (isHttpUrl(url) && !urls.includes(url)) urls.push(url);
    }
  }

  // Atom: <entry> ... <link href="url" .../> ... </entry>
  // Prefer rel="alternate" links; fall back to any <link> with href.
  for (const entryMatch of content.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const entryContent = entryMatch[1] ?? "";

    // Collect all <link .../> elements in this entry and extract their href/rel attributes
    let alternateUrl: string | undefined;
    let firstUrl: string | undefined;

    for (const linkMatch of entryContent.matchAll(/<link\b([^>]*?)\/?>|<link\b([^>]*)>/gi)) {
      const attrs = linkMatch[1] ?? linkMatch[2] ?? "";
      const hrefMatch = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i);
      const relMatch = attrs.match(/\brel\s*=\s*["']([^"']+)["']/i);
      const href = hrefMatch?.[1]?.trim();
      const rel = relMatch?.[1]?.trim().toLowerCase();
      if (!href || !isHttpUrl(href)) continue;
      if (rel === "alternate") {
        alternateUrl = href;
        break; // prefer alternate — no need to look further
      }
      if (!firstUrl) firstUrl = href;
    }

    const url = alternateUrl ?? firstUrl;
    if (url && !urls.includes(url)) urls.push(url);
  }

  return urls;
}

/** Parse URLs from `content` using the given format. */
export function parseUrls(content: string, format: ImportFormat): string[] {
  switch (format) {
    case "opml":
      return parseOpmlUrls(content);
    case "netscape":
      return parseNetscapeUrls(content);
    case "rss":
      return parseRssUrls(content);
    case "text":
      return parseTextUrls(content);
  }
}
