import type Database from "bun:sqlite";
import { safeFetch } from "../ssrf-guard";
import type { StorageBackend } from "../storage";

/**
 * Produce a self-contained HTML file with external CSS and images inlined as
 * base64 data URIs, using a custom inliner instead of single-file-cli.
 *
 * ADR: single-file-cli is a Node CLI tool (~50 MB of transitive deps) and
 * would conflict with the zero-dependency goal for @webfrost/core. Instead we
 * implement a focused inliner: CSS <link> tags are fetched and replaced with
 * inline <style> blocks; relative url() references inside that CSS are rebased
 * to absolute URLs (and font files are additionally inlined as base64 data
 * URIs); <img src> pointing at external HTTP URLs are replaced with data URIs.
 * Background images in inline style attributes are left as-is.
 *
 * The page must already have called page.goto() before this extractor runs.
 */
export async function singleFileExtractor(
  db: Database,
  snapshotId: number,
  storage: StorageBackend,
  page: import("playwright").Page,
): Promise<void> {
  let html: string;
  const pageUrl = page.url();

  try {
    html = await page.content();
  } catch (err) {
    console.warn("[singlefile] extraction failed:", err);
    return;
  }

  const inlined = await inlineAssets(html, pageUrl);

  const ref = await storage.putText(snapshotId, "singlefile.html", inlined);

  db.query<null, [number, string]>(
    "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'singlefile', ?)",
  ).run(snapshotId, ref);
}

/**
 * Inline external CSS and image assets referenced in the HTML string.
 * Fetch errors for individual assets are silently swallowed — the resulting
 * file may have broken references but is still a valid HTML document.
 */
async function inlineAssets(html: string, baseUrl: string): Promise<string> {
  // Inline external stylesheets: <link rel="stylesheet" href="...">
  const afterCss = await inlineCssLinks(html, baseUrl);
  // Inline images: <img src="...">
  const afterImages = await inlineImages(afterCss, baseUrl);
  return afterImages;
}

async function inlineCssLinks(input: string, baseUrl: string): Promise<string> {
  // Match <link ... rel="stylesheet" ... href="..."> or <link ... href="..." ... rel="stylesheet" ...>
  const linkRe = /<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi;
  const hrefRe = /\bhref=["']([^"']+)["']/i;

  const matches = [...input.matchAll(linkRe)];
  if (matches.length === 0) return input;

  const replacements = await Promise.all(
    matches.map(async (m) => {
      const tag = m[0];
      const hrefMatch = hrefRe.exec(tag);
      if (!hrefMatch?.[1]) return { tag, replacement: tag };
      const url = resolveUrl(hrefMatch[1], baseUrl);
      if (!url) return { tag, replacement: tag };
      try {
        const res = await safeFetch(url);
        if (!res.ok) return { tag, replacement: tag };
        const css = await res.text();
        const rebased = await rebaseCssUrls(css, url);
        return { tag, replacement: `<style>${rebased}</style>` };
      } catch {
        return { tag, replacement: tag };
      }
    }),
  );

  let result = input;
  for (const { tag, replacement } of replacements) {
    if (tag !== replacement) {
      result = result.replace(tag, replacement);
    }
  }
  return result;
}

async function inlineImages(input: string, baseUrl: string): Promise<string> {
  // Match <img ... src="..."> (skip data URIs and relative paths that can't be fetched)
  const imgRe = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;

  const matches = [...input.matchAll(imgRe)];
  if (matches.length === 0) return input;

  const replacements = await Promise.all(
    matches.map(async (m) => {
      const tag = m[0];
      const src = m[1];
      if (!src || src.startsWith("data:")) return { tag, src, dataUri: null };
      const url = resolveUrl(src, baseUrl);
      if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
        return { tag, src, dataUri: null };
      }
      try {
        const res = await safeFetch(url);
        if (!res.ok) return { tag, src, dataUri: null };
        const contentType = res.headers.get("content-type") ?? "image/png";
        const buf = await res.arrayBuffer();
        const b64 = Buffer.from(buf).toString("base64");
        return { tag, src, dataUri: `data:${contentType};base64,${b64}` };
      } catch {
        return { tag, src, dataUri: null };
      }
    }),
  );

  let result = input;
  for (const { tag, src, dataUri } of replacements) {
    if (dataUri) {
      result = result.replace(tag, tag.replace(src, dataUri));
    }
  }
  return result;
}

/**
 * Rebase all url() references in a CSS string to absolute URLs resolved
 * against the URL of the CSS file itself. Font files (.woff, .woff2, .ttf,
 * .otf, .eot) are additionally fetched and inlined as base64 data URIs so
 * they survive when the HTML file is opened locally (file:// context).
 */
async function rebaseCssUrls(css: string, cssFileUrl: string): Promise<string> {
  // Matches: url('...'), url("..."), url(...)
  const urlRe = /url\(\s*(['"]?)([^'"\)]+)\1\s*\)/gi;
  const matches = [...css.matchAll(urlRe)];
  if (matches.length === 0) return css;

  const replacements = await Promise.all(
    matches.map(async (m) => {
      const full = m[0] as string;
      const quote = (m[1] as string | undefined) ?? "";
      const href = ((m[2] as string | undefined) ?? "").trim();
      if (!href || href.startsWith("data:")) return { full, replacement: full };

      const absoluteUrl = resolveUrl(href, cssFileUrl);
      if (!absoluteUrl) return { full, replacement: full };

      // Inline font files as base64 data URIs so they work in file:// context.
      if (isFontUrl(absoluteUrl)) {
        try {
          const res = await safeFetch(absoluteUrl);
          if (res.ok) {
            const contentType = res.headers.get("content-type") ?? guessFontMime(absoluteUrl);
            const buf = await res.arrayBuffer();
            const b64 = Buffer.from(buf).toString("base64");
            const dataUri = `data:${contentType};base64,${b64}`;
            return { full, replacement: `url(${quote}${dataUri}${quote})` };
          }
        } catch {
          // Fall through: rebase to absolute URL at minimum.
        }
      }

      return { full, replacement: `url(${quote}${absoluteUrl}${quote})` };
    }),
  );

  let result = css;
  for (const { full, replacement } of replacements) {
    if (full !== replacement) {
      result = result.replace(full, replacement);
    }
  }
  return result;
}

function isFontUrl(url: string): boolean {
  return /\.(woff2?|ttf|otf|eot)(\?.*)?$/i.test(url);
}

function guessFontMime(url: string): string {
  if (/\.woff2(\?|$)/i.test(url)) return "font/woff2";
  if (/\.woff(\?|$)/i.test(url)) return "font/woff";
  if (/\.ttf(\?|$)/i.test(url)) return "font/ttf";
  if (/\.otf(\?|$)/i.test(url)) return "font/otf";
  if (/\.eot(\?|$)/i.test(url)) return "application/vnd.ms-fontobject";
  return "font/woff2";
}

function resolveUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}
