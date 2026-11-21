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

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

/**
 * Decode the character references XML and HTML allow in an attribute or text
 * value (`&amp;`, `&#38;`, `&#x26;`, ...). A feed's `?a=1&amp;b=2` is `?a=1&b=2`.
 * Unknown named references are left as they are.
 */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, ref: string) => {
    if (ref[0] === "#") {
      const code =
        ref[1] === "x" || ref[1] === "X"
          ? Number.parseInt(ref.slice(2), 16)
          : Number.parseInt(ref.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? match;
  });
}

/** Resolve `href` against `base` (when given) and return it if it is http(s). */
function toHttpUrl(href: string, base?: string): string | null {
  try {
    const u = base ? new URL(href, base) : new URL(href);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
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
    const url = decodeEntities(match[1] ?? "").trim();
    if (url && isHttpUrl(url) && !urls.includes(url)) urls.push(url);
  }

  // Also pick up htmlUrl if not already added via xmlUrl
  for (const match of content.matchAll(/<outline\b[^>]*\bhtmlUrl\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const url = decodeEntities(match[1] ?? "").trim();
    if (url && isHttpUrl(url) && !urls.includes(url)) urls.push(url);
  }

  return urls;
}

/** Extract URLs from a Netscape bookmark HTML file (<a href=...>). */
function parseNetscapeUrls(content: string): string[] {
  const urls: string[] = [];
  for (const match of content.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const url = decodeEntities(match[1] ?? "").trim();
    if (url && isHttpUrl(url) && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

/** The text of an element, without a CDATA wrapper (whose content is literal) and with entities decoded. */
function elementText(raw: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw);
  return (cdata ? (cdata[1] ?? "") : decodeEntities(raw)).trim();
}

/** The value of attribute `name` in an attribute list, entities decoded. */
function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(attrs);
  const raw = m?.[1] ?? m?.[2];
  return raw === undefined ? undefined : decodeEntities(raw).trim();
}

/**
 * Extract article URLs from an RSS 2.0 or Atom feed. Relative links (allowed in Atom)
 * are resolved against `xml:base`, then the feed's own URL (`baseUrl`), then its
 * `rel="self"` link.
 */
function parseRssUrls(content: string, baseUrl?: string): string[] {
  const urls: string[] = [];
  const add = (url: string | null) => {
    if (url && !urls.includes(url)) urls.push(url);
  };

  const feedTag = /<feed\b([^>]*)>/i.exec(content)?.[1] ?? "";
  const selfLink = [...content.matchAll(/<link\b([^>]*)>/gi)]
    .map((m) => m[1] ?? "")
    .find((a) => attr(a, "rel")?.toLowerCase() === "self");
  let base = baseUrl ?? toHttpUrl(selfLink ? (attr(selfLink, "href") ?? "") : "") ?? undefined;
  const xmlBase = attr(feedTag, "xml:base");
  if (xmlBase) base = toHttpUrl(xmlBase, base) ?? base;

  // RSS 2.0: <item> ... <link>url</link> ... </item>
  // The <link> element in RSS may contain a CDATA section or plain text.
  for (const itemMatch of content.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const itemContent = itemMatch[1] ?? "";
    const linkMatch = /<link>([\s\S]*?)<\/link>/i.exec(itemContent);
    if (linkMatch?.[1] !== undefined) add(toHttpUrl(elementText(linkMatch[1]), base));
  }

  // Atom: <entry> ... <link href="url" .../> ... </entry>
  // Prefer rel="alternate" links (the default rel); fall back to any <link> with href.
  for (const entryMatch of content.matchAll(/<entry\b([^>]*)>([\s\S]*?)<\/entry>/gi)) {
    const entryBase = attr(entryMatch[1] ?? "", "xml:base");
    const entryBaseUrl = entryBase ? (toHttpUrl(entryBase, base) ?? base) : base;
    const entryContent = entryMatch[2] ?? "";

    let alternateUrl: string | null = null;
    let firstUrl: string | null = null;
    for (const linkMatch of entryContent.matchAll(/<link\b([^>]*)>/gi)) {
      const attrs = linkMatch[1] ?? "";
      const href = attr(attrs, "href");
      const url = href ? toHttpUrl(href, entryBaseUrl) : null;
      if (!url) continue;
      const rel = attr(attrs, "rel")?.toLowerCase() ?? "alternate";
      if (rel === "alternate") {
        alternateUrl = url;
        break; // prefer alternate — no need to look further
      }
      firstUrl ??= url;
    }
    add(alternateUrl ?? firstUrl);
  }

  return urls;
}

/**
 * Parse URLs from `content` using the given format. `baseUrl` is the URL the content
 * was downloaded from, if any: relative links in a feed are resolved against it.
 */
export function parseUrls(content: string, format: ImportFormat, baseUrl?: string): string[] {
  switch (format) {
    case "opml":
      return parseOpmlUrls(content);
    case "netscape":
      return parseNetscapeUrls(content);
    case "rss":
      return parseRssUrls(content, baseUrl);
    case "text":
      return parseTextUrls(content);
  }
}
