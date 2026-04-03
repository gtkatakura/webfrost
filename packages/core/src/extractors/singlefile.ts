import type Database from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Produce a self-contained HTML file with external CSS and images inlined as
 * base64 data URIs, using a custom inliner instead of single-file-cli.
 *
 * ADR: single-file-cli is a Node CLI tool (~50 MB of transitive deps) and
 * would conflict with the zero-dependency goal for @webfrost/core. Instead we
 * implement a focused inliner: CSS <link> tags are fetched and replaced with
 * inline <style> blocks; <img src> pointing at external HTTP URLs are replaced
 * with data URIs. Other asset types (fonts in @font-face, background images in
 * inline style attributes) are left as-is — this covers the common case for
 * article archiving without adding heavyweight dependencies.
 *
 * The page must already have called page.goto() before this extractor runs.
 */
export async function singleFileExtractor(
  db: Database,
  snapshotId: number,
  snapshotDir: string,
  page: import("playwright").Page,
): Promise<void> {
  await mkdir(snapshotDir, { recursive: true });

  let html: string;
  const pageUrl = page.url();

  try {
    html = await page.content();
  } catch (err) {
    console.warn("[singlefile] extraction failed:", err);
    return;
  }

  const inlined = await inlineAssets(html, pageUrl);

  const singleFilePath = join(snapshotDir, "singlefile.html");
  await Bun.write(singleFilePath, inlined);

  db.query<null, [number, string]>(
    "INSERT INTO archive_results (snapshot_id, extractor, content) VALUES (?, 'singlefile', ?)",
  ).run(snapshotId, singleFilePath);
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
        const res = await fetch(url);
        if (!res.ok) return { tag, replacement: tag };
        const css = await res.text();
        return { tag, replacement: `<style>${css}</style>` };
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
        const res = await fetch(url);
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

function resolveUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}
