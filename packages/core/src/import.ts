/**
 * Bulk URL import — detects format and extracts URLs from:
 *   - Plain text (one URL per line)
 *   - OPML (xmlUrl attributes on <outline> elements)
 *   - Netscape bookmark HTML (<a href=...> elements)
 */

export type ImportFormat = "text" | "opml" | "netscape" | "rss";

const DEFAULT_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_IMPORT_MAX_URLS = 10_000;

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** WEBFROST_IMPORT_MAX_BYTES: largest import (file, `content`, fetched URL or feed) in bytes (default 10 MiB). */
export function importMaxBytes(): number {
  return positiveIntEnv("WEBFROST_IMPORT_MAX_BYTES", DEFAULT_IMPORT_MAX_BYTES);
}

/** WEBFROST_IMPORT_MAX_URLS: most URLs one import or one feed run may queue (default 10000). */
export function importMaxUrls(): number {
  return positiveIntEnv("WEBFROST_IMPORT_MAX_URLS", DEFAULT_IMPORT_MAX_URLS);
}

/** An import or feed over WEBFROST_IMPORT_MAX_BYTES or WEBFROST_IMPORT_MAX_URLS. */
export class ImportLimitError extends Error {
  constructor(
    readonly limit: "bytes" | "urls",
    message: string,
  ) {
    super(message);
    this.name = "ImportLimitError";
  }
}

export function importTooLargeMessage(): string {
  return `import is larger than ${importMaxBytes()} bytes (WEBFROST_IMPORT_MAX_BYTES)`;
}

export function importTooManyUrlsMessage(count: number): string {
  return `import has ${count} URLs; the limit is ${importMaxUrls()} (WEBFROST_IMPORT_MAX_URLS)`;
}

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

/**
 * A de-duplicating URL list that refuses to grow past `max + 1` entries: one more than
 * the cap is enough for a caller to see that the import is over it, and parsing stops there.
 */
function collector(max: number) {
  const urls: string[] = [];
  const seen = new Set<string>();
  return {
    urls,
    /** Add `url` unless already present; false once the list is over the cap (stop parsing). */
    add(url: string | null, dedupe = true): boolean {
      if (url && !(dedupe && seen.has(url))) {
        seen.add(url);
        urls.push(url);
      }
      return urls.length <= max;
    },
  };
}

/**
 * The attribute lists of every `<name ...>` start tag, in document order. Linear: each
 * start tag looks for its `>` once, and scanning resumes after it. A tag with no `>` ends
 * the scan, since nothing after it can have one either.
 */
function* startTags(content: string, name: string): Generator<string> {
  const opener = new RegExp(`<${name}\\b`, "gi");
  let pos = 0;
  while (true) {
    opener.lastIndex = pos;
    const m = opener.exec(content);
    if (!m) return;
    const attrsStart = m.index + m[0].length;
    const end = content.indexOf(">", attrsStart);
    if (end === -1) return;
    yield content.slice(attrsStart, end);
    pos = end + 1;
  }
}

/**
 * The `<name ...>inner</name>` elements of `content`: [attributes, inner]. Linear for the
 * same reason as startTags; an element that never closes ends the scan, and nested
 * same-name elements are not supported (as before).
 */
function* elements(content: string, name: string): Generator<[string, string]> {
  const opener = new RegExp(`<${name}\\b`, "gi");
  const closer = new RegExp(`</${name}\\s*>`, "gi");
  let pos = 0;
  while (true) {
    opener.lastIndex = pos;
    const m = opener.exec(content);
    if (!m) return;
    const attrsStart = m.index + m[0].length;
    const tagEnd = content.indexOf(">", attrsStart);
    if (tagEnd === -1) return;
    closer.lastIndex = tagEnd + 1;
    const c = closer.exec(content);
    if (!c) return;
    yield [content.slice(attrsStart, tagEnd), content.slice(tagEnd + 1, c.index)];
    pos = c.index + c[0].length;
  }
}

/** Extract URLs from plain text (one URL per line, blank lines ignored). */
function parseTextUrls(content: string, max: number): string[] {
  const out = collector(max);
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length > 0 && !line.startsWith("#") && isHttpUrl(line) && !out.add(line, false)) break;
  }
  return out.urls;
}

/** Extract URLs from OPML: reads xmlUrl, then htmlUrl, attributes on all <outline> elements. */
function parseOpmlUrls(content: string, max: number): string[] {
  const out = collector(max);
  const outlines = [...startTags(content, "outline")];
  for (const name of ["xmlUrl", "htmlUrl"]) {
    // htmlUrl is only picked up when not already added via xmlUrl (the collector dedupes).
    for (const attrs of outlines) {
      const url = attr(attrs, name);
      if (url && isHttpUrl(url) && !out.add(url)) return out.urls;
    }
  }
  return out.urls;
}

/** Extract URLs from a Netscape bookmark HTML file (<a href=...>). */
function parseNetscapeUrls(content: string, max: number): string[] {
  const out = collector(max);
  for (const attrs of startTags(content, "a")) {
    const url = attr(attrs, "href");
    if (url && isHttpUrl(url) && !out.add(url)) break;
  }
  return out.urls;
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
function parseRssUrls(content: string, max: number, baseUrl?: string): string[] {
  const out = collector(max);

  const feedTag = startTags(content, "feed").next().value ?? "";
  let base = baseUrl;
  if (base === undefined) {
    for (const attrs of startTags(content, "link")) {
      if (attr(attrs, "rel")?.toLowerCase() === "self") {
        base = toHttpUrl(attr(attrs, "href") ?? "") ?? undefined;
        break;
      }
    }
  }
  const xmlBase = attr(feedTag, "xml:base");
  if (xmlBase) base = toHttpUrl(xmlBase, base) ?? base;

  // RSS 2.0: <item> ... <link>url</link> ... </item>
  // The <link> element in RSS may contain a CDATA section or plain text.
  for (const [, itemContent] of elements(content, "item")) {
    const linkMatch = /<link>([\s\S]*?)<\/link>/i.exec(itemContent);
    if (linkMatch?.[1] !== undefined && !out.add(toHttpUrl(elementText(linkMatch[1]), base))) {
      return out.urls;
    }
  }

  // Atom: <entry> ... <link href="url" .../> ... </entry>
  // Prefer rel="alternate" links (the default rel); fall back to any <link> with href.
  for (const [entryAttrs, entryContent] of elements(content, "entry")) {
    const entryBase = attr(entryAttrs, "xml:base");
    const entryBaseUrl = entryBase ? (toHttpUrl(entryBase, base) ?? base) : base;

    let alternateUrl: string | null = null;
    let firstUrl: string | null = null;
    for (const attrs of startTags(entryContent, "link")) {
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
    if (!out.add(alternateUrl ?? firstUrl)) return out.urls;
  }

  return out.urls;
}

export interface ParseOptions {
  /**
   * Stop once more than this many URLs were found, returning `maxUrls + 1` of them, so
   * the caller can tell the input is over the limit without parsing all of it.
   * Default: no limit.
   */
  maxUrls?: number;
}

/**
 * Parse URLs from `content` using the given format. `baseUrl` is the URL the content
 * was downloaded from (after redirects), if any: relative links in a feed are resolved
 * against it. Parsing is linear in the size of `content`.
 */
export function parseUrls(
  content: string,
  format: ImportFormat,
  baseUrl?: string,
  options: ParseOptions = {},
): string[] {
  const max = options.maxUrls ?? Number.POSITIVE_INFINITY;
  switch (format) {
    case "opml":
      return parseOpmlUrls(content, max);
    case "netscape":
      return parseNetscapeUrls(content, max);
    case "rss":
      return parseRssUrls(content, max, baseUrl);
    case "text":
      return parseTextUrls(content, max);
  }
}
