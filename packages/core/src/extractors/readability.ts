import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import type { Db } from "../db";
import { recordResult } from "../results";
import { envInt } from "../ssrf-guard";

/**
 * Parsing is synchronous and blocks the event loop; JSDOM on a huge page takes
 * seconds and a lot of memory. Larger inputs are cut (WEBFROST_READABILITY_MAX_BYTES).
 */
const DEFAULT_READABILITY_MAX_BYTES = 10 * 1024 * 1024;

/** Cut `html` to at most `maxBytes` of UTF-8 (0 = no cap). */
export function capHtml(html: string, maxBytes: number): string {
  // A UTF-8 character is at most 3 bytes per UTF-16 code unit: shorter strings are under the cap.
  if (maxBytes <= 0 || html.length * 3 <= maxBytes) return html;
  const bytes = new TextEncoder().encode(html);
  if (bytes.byteLength <= maxBytes) return html;
  // A character cut in half at the end decodes to U+FFFD; drop it.
  return new TextDecoder().decode(bytes.subarray(0, maxBytes)).replace(/\uFFFD$/, "");
}

const BLOCK = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DETAILS",
  "DIV",
  "DL",
  "DT",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "SUMMARY",
  "TABLE",
  "TR",
  "UL",
]);

/**
 * The article as plain text with one blank line between blocks. Readability's own
 * textContent joins blocks with nothing in between ("Open SourceKeep the web"), so the
 * reader view and search snippets would run headings and paragraphs together.
 */
export function blockText(root: Node): string {
  const out: string[] = [];
  const walk = (node: Node, pre: boolean) => {
    if (node.nodeType === 3) {
      const text = node.textContent ?? "";
      // <pre> indentation is protected from the per-line trim below.
      out.push(
        pre ? text.replace(/ /g, "\uE000").replace(/\t/g, "\uE001") : text.replace(/\s+/g, " "),
      );
      return;
    }
    if (node.nodeType === 11) {
      // The fragment the article is parsed into: walk its children.
      for (const child of node.childNodes) walk(child, pre);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (el.tagName === "BR") {
      out.push("\n");
      return;
    }
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE") return;
    const block = BLOCK.has(el.tagName);
    if (block) out.push("\n\n");
    for (const child of el.childNodes) walk(child, pre || el.tagName === "PRE");
    if (block) out.push("\n\n");
  };
  walk(root, false);
  return out
    .join("")
    .split("\n")
    .map((line) => line.replace(/^[ \t]+|[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .replace(/\uE000/g, " ")
    .replace(/\uE001/g, "\t");
}

interface ReadabilityResult {
  title: string | null;
  byline: string | null;
  textContent: string | null;
  excerpt: string | null;
}

export async function readabilityExtractor(
  db: Db,
  snapshotId: number,
  url: string,
  html: string,
  lease?: string,
): Promise<void> {
  let result: ReadabilityResult;
  try {
    const input = capHtml(
      html,
      envInt("WEBFROST_READABILITY_MAX_BYTES", DEFAULT_READABILITY_MAX_BYTES),
    );
    const dom = new JSDOM(input, { url });
    // The page's own <title>, read before Readability rewrites the document: pages that are
    // not articles (a video, an app) still get a name.
    const pageTitle = dom.window.document.title.trim() || null;
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    result = {
      title: article?.title || pageTitle,
      byline: article?.byline ?? null,
      textContent: article?.content
        ? blockText(JSDOM.fragment(article.content))
        : (article?.textContent ?? null),
      excerpt: article?.excerpt ?? null,
    };
  } catch {
    result = { title: null, byline: null, textContent: null, excerpt: null };
  }

  const content = JSON.stringify(result);
  await recordResult(
    db,
    snapshotId,
    { extractor: "readability", content, sizeBytes: Buffer.byteLength(content, "utf8") },
    lease,
  );
}
