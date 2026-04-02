/**
 * Bulk URL import — detects format and extracts URLs from:
 *   - Plain text (one URL per line)
 *   - OPML (xmlUrl attributes on <outline> elements)
 *   - Netscape bookmark HTML (<a href=...> elements)
 */

export type ImportFormat = "text" | "opml" | "netscape";

/** Detect the format from filename and/or content. */
export function detectFormat(filename: string, content: string): ImportFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".opml")) return "opml";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    // Netscape bookmarks contain the DOCTYPE marker
    if (content.includes("NETSCAPE-Bookmark-file") || content.includes("netscape-bookmark-file")) {
      return "netscape";
    }
  }
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

/** Parse URLs from `content` using the given format. */
export function parseUrls(content: string, format: ImportFormat): string[] {
  switch (format) {
    case "opml":
      return parseOpmlUrls(content);
    case "netscape":
      return parseNetscapeUrls(content);
    case "text":
      return parseTextUrls(content);
  }
}
