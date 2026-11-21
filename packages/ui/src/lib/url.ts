export type UrlResult = { ok: true; url: string } | { ok: false; error: string };

export const URL_ERROR = "Enter a valid web address, like example.com or https://example.com.";

/**
 * Accepts what people actually type ("example.com", "  https://example.com/a ") and returns
 * an absolute http(s) URL, prepending https:// when there is no scheme.
 */
export function normalizeUrl(input: string): UrlResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "Enter a web address." };
  if (/\s/.test(trimmed)) return { ok: false, error: URL_ERROR };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, error: "Only http and https addresses can be archived." };
    }
    if (!parsed.hostname) return { ok: false, error: URL_ERROR };
    return { ok: true, url: parsed.href };
  } catch {
    return { ok: false, error: URL_ERROR };
  }
}

/** Parses a positive integer from a URL parameter; anything else (NaN, 0, "abc") is null. */
export function parsePositiveInt(value: string | null | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const n = Number.parseInt(value, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
