import { ConcurrencyLimiter } from "../concurrency";
import type { Db } from "../db";
import { recordResult } from "../results";
import { envInt, safeFetch } from "../ssrf-guard";
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
 *
 * Throws if the page content cannot be read; the pipeline records that as a
 * failed extractor without failing the snapshot. Individual assets that fail
 * to download are left as external references.
 */
/** A media condition no screen matches (a 0.001 px viewport), and one every screen matches. */
const NEVER = "(max-width: 0.001px)";
const ALWAYS = "(min-width: 0px)";

/**
 * Keep the archived copy in the theme it was archived in. Its stylesheets still hold both themes behind
 * `prefers-color-scheme`, which a browser answers with the viewer's system setting (a frame does not take
 * the embedding page's color-scheme), so a page archived dark showed light on a light system. The
 * condition for the archived scheme becomes always true and the other never true, wherever it appears:
 * @media rules, <link media>, <source media>, inline styles.
 */
export function freezeColorScheme(html: string, scheme: "light" | "dark"): string {
  return html.replace(/\(\s*prefers-color-scheme\s*:\s*(light|dark)\s*\)/gi, (_m, value: string) =>
    value.toLowerCase() === scheme ? ALWAYS : NEVER,
  );
}

export async function singleFileExtractor(
  db: Db,
  snapshotId: number,
  storage: StorageBackend,
  page: import("playwright").Page,
  signal?: AbortSignal,
  lease?: string,
): Promise<void> {
  const pageUrl = page.url();
  const html = await page.content();

  // The theme the page was archived in, as the page itself saw it.
  const dark = await Promise.resolve()
    .then(() => page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches))
    .catch(() => false);
  const inlined = freezeColorScheme(
    await inlineAssets(html, pageUrl, signal),
    dark ? "dark" : "light",
  );
  // Inlining fetches every asset and can outlive the pipeline's timeout for this
  // extractor: if it was given up on, do not store or record a late result.
  signal?.throwIfAborted();

  const ref = await storage.putText(snapshotId, "singlefile.html", inlined);

  await recordResult(
    db,
    snapshotId,
    { extractor: "singlefile", content: ref, sizeBytes: Buffer.byteLength(inlined, "utf8") },
    lease,
  );
}

/** Asset downloads running at once for one page (WEBFROST_SINGLEFILE_CONCURRENCY). */
const DEFAULT_ASSET_CONCURRENCY = 8;
/** Total bytes of assets inlined into one page (WEBFROST_SINGLEFILE_MAX_BYTES). */
const DEFAULT_MAX_INLINE_BYTES = 100 * 1024 * 1024;

/** Shared by every asset download of one page: fan-out cap, byte budget, cancellation. */
interface InlineContext {
  limiter: ConcurrencyLimiter;
  /** Bytes still allowed to be inlined. */
  remaining: number;
  signal: AbortSignal | undefined;
}

/**
 * Download an asset for inlining, or return null to leave it as a remote URL:
 * on any error, a non-2xx status, or when it does not fit in the byte budget.
 * Only the download itself holds a concurrency slot, so a stylesheet waiting
 * for its fonts never blocks the fonts.
 */
async function fetchAsset(
  ctx: InlineContext,
  url: string,
): Promise<{ bytes: Uint8Array; contentType: string | null } | null> {
  if (ctx.remaining <= 0 || ctx.signal?.aborted) return null;
  try {
    return await ctx.limiter.run(async () => {
      if (ctx.remaining <= 0 || ctx.signal?.aborted) return null;
      const res = await safeFetch(url, ctx.signal ? { signal: ctx.signal } : {});
      if (!res.ok) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > ctx.remaining) return null;
      ctx.remaining -= bytes.byteLength;
      return { bytes, contentType: res.headers.get("content-type") };
    });
  } catch {
    return null;
  }
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

/**
 * Replace each `[start, end)` span of `input` with its text, in one pass. Spans
 * must be sorted and must not overlap. Unlike `String.replace` with a string,
 * nothing in the replacement is interpreted (`$&` or `$'` in CSS stay literal)
 * and every occurrence is handled, not just the first.
 */
function spliceAll(input: string, edits: Array<Edit | null>): string {
  let out = "";
  let pos = 0;
  for (const edit of edits) {
    if (!edit) continue;
    out += input.slice(pos, edit.start) + edit.text;
    pos = edit.end;
  }
  return out + input.slice(pos);
}

/**
 * Inline external CSS and image assets referenced in the HTML string.
 * Assets that fail to download, or no longer fit in the byte budget, stay as
 * external references; the result is still a valid HTML document.
 */
export async function inlineAssets(
  html: string,
  baseUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  const ctx: InlineContext = {
    limiter: new ConcurrencyLimiter(
      Math.max(1, envInt("WEBFROST_SINGLEFILE_CONCURRENCY", DEFAULT_ASSET_CONCURRENCY)),
    ),
    remaining: envInt("WEBFROST_SINGLEFILE_MAX_BYTES", DEFAULT_MAX_INLINE_BYTES),
    signal,
  };
  // Inline external stylesheets: <link rel="stylesheet" href="...">
  // The page's own CSS first (<style> blocks, style="" attributes): its url() images are inlined too.
  const afterInline = await inlineInlineCss(html, baseUrl, ctx);
  const afterCss = await inlineCssLinks(afterInline, baseUrl, ctx);
  // Inline images: <img src="...">
  return inlineImages(afterCss, baseUrl, ctx);
}

/**
 * url() references in the page's own CSS: <style> blocks and style="" attributes (sites put logos and
 * backgrounds there, e.g. style="--logo:url(/logos/x.svg)" for a CSS mask). They resolve against the page.
 */
async function inlineInlineCss(
  input: string,
  baseUrl: string,
  ctx: InlineContext,
): Promise<string> {
  const blocks = await Promise.all(
    [...input.matchAll(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi)].map(
      async (m): Promise<Edit | null> => {
        const css = m[2] ?? "";
        if (!/url\(/i.test(css)) return null;
        const rebased = await rebaseCssUrls(css, baseUrl, ctx);
        return { start: m.index, end: m.index + m[0].length, text: `${m[1]}${rebased}${m[3]}` };
      },
    ),
  );
  const afterBlocks = spliceAll(input, blocks);
  const attrs = await Promise.all(
    [...afterBlocks.matchAll(/\sstyle=(["'])([^"']*url\([^"']*)\1/gi)].map(
      async (m): Promise<Edit | null> => {
        // Attribute values are HTML: decode, rebase as CSS, then escape again for the attribute.
        const css = decodeAttr(m[2] ?? "");
        const rebased = await rebaseCssUrls(css, baseUrl, ctx);
        const value = rebased.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
        return { start: m.index, end: m.index + m[0].length, text: ` style="${value}"` };
      },
    ),
  );
  return spliceAll(afterBlocks, attrs);
}

async function inlineCssLinks(input: string, baseUrl: string, ctx: InlineContext): Promise<string> {
  // Match <link ... rel="stylesheet" ... href="..."> or <link ... href="..." ... rel="stylesheet" ...>
  const linkRe = /<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi;
  const hrefRe = /\bhref=["']([^"']+)["']/i;
  const mediaRe = /\bmedia=["']([^"']*)["']/i;

  const edits = await Promise.all(
    [...input.matchAll(linkRe)].map(async (m): Promise<Edit | null> => {
      const tag = m[0];
      const hrefMatch = hrefRe.exec(tag);
      if (!hrefMatch?.[1]) return null;
      // Attribute values are HTML: `?a=1&amp;b=2` is the URL `?a=1&b=2`.
      const url = resolveUrl(decodeAttr(hrefMatch[1]), baseUrl);
      if (!url) return null;
      const asset = await fetchAsset(ctx, url);
      if (!asset) return null;
      const css = new TextDecoder().decode(asset.bytes);
      const rebased = await rebaseCssUrls(css, url, ctx);
      // Keep the link's media query, or print-only CSS would apply on screen.
      const media = mediaRe.exec(tag)?.[1]?.trim();
      const open = media && media !== "all" ? `<style media="${media}">` : "<style>";
      return { start: m.index, end: m.index + tag.length, text: `${open}${rebased}</style>` };
    }),
  );
  return spliceAll(input, edits);
}

async function inlineImages(input: string, baseUrl: string, ctx: InlineContext): Promise<string> {
  // Match <img ... src="..."> (skip data URIs and relative paths that can't be fetched).
  // The `d` flag gives the position of the src value, so exactly that is replaced.
  const imgRe = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  const srcRe = /\bsrc=(["'])[^"']+\1/i;
  // srcset and sizes win over src in the browser, and their remote URLs are blocked in the
  // archived copy: once src holds the image, they go.
  const srcsetRe = /\s(?:srcset|sizes)=(["'])[^"']*\1/gi;

  const edits = await Promise.all(
    [...input.matchAll(imgRe)].map(async (m): Promise<Edit | null> => {
      const tag = m[0];
      const src = m[1];
      if (!src || src.startsWith("data:")) return null;
      const url = resolveUrl(decodeAttr(src), baseUrl);
      if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) return null;
      const asset = await fetchAsset(ctx, url);
      if (!asset) return null;
      const contentType = asset.contentType ?? "image/png";
      const b64 = Buffer.from(asset.bytes).toString("base64");
      const dataUri = `data:${contentType};base64,${b64}`;
      const text = tag.replace(srcsetRe, "").replace(srcRe, () => `src="${dataUri}"`);
      return { start: m.index, end: m.index + tag.length, text };
    }),
  );
  // A <picture>'s <source srcset> wins over its <img> and points at the network, which the
  // archived copy never reaches: drop them so the inlined <img> is what shows.
  return spliceAll(input, edits).replace(/<source\b[^>]*\bsrcset=[^>]*>/gi, "");
}

/**
 * Rebase all url() references in a CSS string to absolute URLs resolved
 * against the URL of the CSS file itself, and inline what they point to (fonts,
 * background images, icons) as base64 data URIs while the byte budget lasts:
 * the archived copy loads nothing from the network, so a remote url() would
 * stay blank. What does not fit or fails stays as an absolute URL.
 */
async function rebaseCssUrls(css: string, cssFileUrl: string, ctx: InlineContext): Promise<string> {
  // Matches: url('...'), url("..."), url(...)
  const urlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

  const edits = await Promise.all(
    [...css.matchAll(urlRe)].map(async (m): Promise<Edit | null> => {
      const quote = m[1] ?? "";
      const href = (m[2] ?? "").trim();
      if (!href || href.startsWith("data:")) return null;
      const absoluteUrl = resolveUrl(href, cssFileUrl);
      if (!absoluteUrl) return null;
      const edit = (target: string): Edit => ({
        start: m.index,
        end: m.index + m[0].length,
        text: `url(${quote}${target}${quote})`,
      });

      if (absoluteUrl.startsWith("http://") || absoluteUrl.startsWith("https://")) {
        const asset = await fetchAsset(ctx, absoluteUrl);
        if (asset) {
          const contentType =
            asset.contentType ??
            (isFontUrl(absoluteUrl) ? guessFontMime(absoluteUrl) : "image/png");
          return edit(`data:${contentType};base64,${Buffer.from(asset.bytes).toString("base64")}`);
        }
      }
      // Rebase to an absolute URL at minimum.
      return edit(absoluteUrl);
    }),
  );
  return spliceAll(css, edits);
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

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Decode the character references an HTML attribute value may hold (`&amp;`, `&#38;`, `&#x26;`). */
export function decodeAttr(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code =
        ref[1] === "x" || ref[1] === "X" ? Number.parseInt(ref.slice(2), 16) : Number(ref.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

function resolveUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}
