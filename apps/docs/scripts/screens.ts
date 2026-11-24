/**
 * The web UI screenshots in app/assets/screens, light and dark, at 1440×900 (2× pixels), and the README's
 * (.github/assets/screenshot-*.webp, the snapshot list).
 *
 *   mise run docs:screens -- <base-url> <viewer-snapshot-id> [search-query]
 *
 * Point it at a running WebFrost (AUTH_DISABLED=true, or a public-read instance) whose archive
 * holds a few real pages; the viewer shot is of <viewer-snapshot-id>. Re-run after UI changes.
 */
import { resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const [base, viewerId, query = "archiving"] = process.argv.slice(2);
if (!base || !viewerId) {
  console.error("usage: screens.ts <base-url> <viewer-snapshot-id> [search-query]");
  process.exit(1);
}

const out = resolve(import.meta.dir, "../app/assets/screens");
const readme = resolve(import.meta.dir, "../../../.github/assets");
const shots = [
  { name: "dashboard", path: "/#/" },
  { name: "snapshots", path: "/#/snapshots" },
  { name: "search", path: `/#/search?q=${encodeURIComponent(query)}` },
  { name: "snapshot-panel", path: `/#/snapshots/${viewerId}` },
  // Needs a few failed snapshots in the archive (a domain that does not exist, a 404, a 403).
  { name: "failures", path: "/#/failures" },
];

const browser = await chromium.launch(
  process.env.WEBFROST_CHROMIUM_PATH ? { executablePath: process.env.WEBFROST_CHROMIUM_PATH } : {},
);
for (const theme of ["light", "dark"] as const) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: theme,
  });
  await context.addInitScript((t) => {
    try {
      localStorage.setItem("webfrost-theme", t);
      localStorage.removeItem("webfrost-snapshot-density");
    } catch {}
  }, theme);
  const page = await context.newPage();
  for (const shot of shots) {
    // "load", not "networkidle": a video in the viewer keeps the network busy.
    await page.goto(new URL(shot.path, base).href, { waitUntil: "load" });
    await page.waitForTimeout(2500);
    await page.mouse.move(0, 0);
    const png = await page.screenshot();
    await sharp(png).webp({ quality: 82 }).toFile(`${out}/${shot.name}-${theme}.webp`);
    console.log(`${shot.name}-${theme}.webp`);
    if (shot.name === "snapshots") {
      await sharp(png)
        .resize(2560)
        .webp({ quality: 80 })
        .toFile(`${readme}/screenshot-${theme}.webp`);
    }
  }
  await context.close();
}
await browser.close();
