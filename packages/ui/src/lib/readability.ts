export interface ReadabilityContent {
  title?: string | null;
  byline?: string | null;
  textContent?: string | null;
  excerpt?: string | null;
}

/** Parses the readability extractor's stored JSON; null when it is missing or malformed. */
export function parseReadability(content: string | null): ReadabilityContent | null {
  if (!content) return null;
  try {
    const value: unknown = JSON.parse(content);
    return value && typeof value === "object" ? (value as ReadabilityContent) : null;
  } catch {
    return null;
  }
}

/** Split plain text into paragraphs on blank lines. */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
