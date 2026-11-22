/**
 * Publish the Archify diagrams: `bun apps/docs/scripts/diagrams.ts [name ...]` (no name: all of them).
 *
 * For each apps/docs/diagrams-src/<name>/<name>.html, written by Archify's `finalize` from the
 * candidate.json next to it, this opens the page in Chromium, runs the viewer's own "SVG light" and
 * "SVG dark" exports, and writes:
 *
 * - public/diagrams/<name>.light.svg and <name>.dark.svg   the images the docs pages show
 * - public/diagrams/<name>.html                             the interactive viewer they link to
 * - app/lib/diagrams.json                                   every diagram's size, for <ArchDiagram>
 *
 * Chromium: WEBFROST_CHROMIUM_PATH when set, else Playwright's own (`mise run setup` installs it).
 */
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const docs = resolve(import.meta.dir, "..");
const sources = resolve(docs, "diagrams-src");
const out = resolve(docs, "public/diagrams");

/** Font subsets the viewer embeds that Latin labels never use. */
const UNUSED_FONT_SUBSETS =
  /\/\* (?:cyrillic-ext|cyrillic|greek-ext|greek|vietnamese|latin-ext) \*\/\s*@font-face\s*\{[^}]*\}/g;

async function rendered(): Promise<string[]> {
  const names: string[] = [];
  for (const entry of await readdir(sources, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      (await Bun.file(resolve(sources, entry.name, `${entry.name}.html`)).exists())
    ) {
      names.push(entry.name);
    }
  }
  return names.sort();
}

const names = process.argv.length > 2 ? process.argv.slice(2) : await rendered();
const executablePath = process.env.WEBFROST_CHROMIUM_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 1440, height: 900 },
});

for (const name of names) {
  const html = resolve(sources, name, `${name}.html`);
  if (!(await Bun.file(html).exists()))
    throw new Error(`${html} is missing: run Archify's finalize first`);
  const page = await context.newPage();
  await page.goto(`file://${html}`);
  await page.waitForSelector('button[data-format="svg-light"]', { state: "attached" });
  for (const theme of ["light", "dark"] as const) {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.evaluate((t) => {
        document.querySelector<HTMLButtonElement>(`button[data-format="svg-${t}"]`)?.click();
      }, theme),
    ]);
    const path = await download.path();
    let svg = await Bun.file(path).text();
    const text = svg.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "");
    // Characters the font's "latin" subset covers (Basic Latin, Latin-1, general punctuation, arrows).
    if (/^[\t\n\r -~\u00a0-\u00ff\u2000-\u206f\u2191\u2193\u2212]*$/.test(text)) {
      svg = svg.replace(UNUSED_FONT_SUBSETS, "");
    }
    await Bun.write(resolve(out, `${name}.${theme}.svg`), svg);
  }
  await page.close();
  await Bun.write(resolve(out, `${name}.html`), Bun.file(html));
  console.log(`diagrams/${name}: light and dark SVG, interactive HTML`);
}
await browser.close();

// The sizes of every published diagram, so pages reserve their space before the image arrives.
const sizes: Record<string, { width: number; height: number }> = {};
for (const file of (await readdir(out)).filter((f) => f.endsWith(".light.svg")).sort()) {
  const svg = await Bun.file(resolve(out, file)).text();
  const box = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(svg);
  if (!box) throw new Error(`${file} has no viewBox`);
  sizes[file.replace(/\.light\.svg$/, "")] = {
    width: Math.round(Number(box[1])),
    height: Math.round(Number(box[2])),
  };
}
await Bun.write(resolve(docs, "app/lib/diagrams.json"), `${JSON.stringify(sizes, null, 2)}\n`);
