import { fileURLToPath } from "node:url";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { defineConfig } from "vite";
import { imagetools } from "vite-imagetools";
import { imagePresets } from "./image-presets.ts";

export default defineConfig({
  // Images are resized, cropped and re-encoded at build time from the masters in app/assets: pages import
  // them with `?preset=…` (image-presets.ts) and draw them with <Picture>. The site is prerendered and has
  // no server to do it on request. SVG is included so icons can be rasterized to PNG.
  plugins: [
    imagePresets(),
    imagetools({ include: /^[^?]+\.(avif|gif|heif|jpe?g|png|svg|tiff|webp)\?.*$/ }),
    fumadocsMdx(),
    tailwindcss(),
    reactRouter(),
  ],
  resolve: {
    tsconfigPaths: true,
    // Also for MDX pages, which tsconfig paths do not cover.
    alias: { "@/": `${fileURLToPath(new URL("./app/", import.meta.url))}` },
  },
});
