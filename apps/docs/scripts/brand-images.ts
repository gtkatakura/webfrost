/**
 * Images that are not built with the site: run `mise run brand` after changing the art in app/assets/brand.
 *
 * - app/assets/brand/share.webp   the full art widened to the 1200×630 link-preview shape, by repeating
 *                                 its own edges (the site's `?preset=og` resizes it)
 * - .github/assets/banner.webp    the README banner
 * - .github/assets/social-preview.jpg   for GitHub → Settings → Social preview (1280×640, under 1 MB)
 * - packages/ui/public/favicon.svg      the web app's tab icon, the same mark as the docs
 */
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const docs = resolve(import.meta.dir, "..");
const repo = resolve(docs, "../..");
const brand = resolve(docs, "app/assets/brand");

async function out(path: string) {
  await mkdir(dirname(path), { recursive: true });
  return path;
}

const full = sharp(resolve(brand, "mascot-full.webp"));
const { width = 0, height = 0 } = await full.metadata();
const wide = Math.round((height * 1200) / 630);
const side = Math.max(0, Math.round((wide - width) / 2));
const share = await full
  .extend({ left: side, right: side, extendWith: "copy" })
  .webp({ lossless: true })
  .toBuffer();
await sharp(share).toFile(resolve(brand, "share.webp"));

await sharp(share)
  .resize(1280)
  .webp({ quality: 82 })
  .toFile(await out(resolve(repo, ".github/assets/banner.webp")));
await sharp(share)
  .resize(1280, 640, { fit: "cover" })
  .jpeg({ quality: 85, mozjpeg: true })
  .toFile(await out(resolve(repo, ".github/assets/social-preview.jpg")));

await copyFile(
  resolve(docs, "public/favicon.svg"),
  await out(resolve(repo, "packages/ui/public/favicon.svg")),
);

console.log("brand images written");
