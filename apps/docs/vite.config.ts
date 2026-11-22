import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { type Plugin, defineConfig } from "vite";
import { imagetools } from "vite-imagetools";
import { imagePresets } from "./image-presets.ts";

/**
 * https://webfrost.dev/compose.yml is the repository's docker-compose.prod.yml, copied at build time so
 * the quickstart (`curl -fsSLO https://webfrost.dev/compose.yml && docker compose up -d`) always gets the
 * current file.
 */
function composeFile(): Plugin {
  const source = fileURLToPath(new URL("../../docker-compose.prod.yml", import.meta.url));
  return {
    name: "webfrost:compose-file",
    generateBundle() {
      if (this.environment?.name !== "client") return;
      this.emitFile({
        type: "asset",
        fileName: "compose.yml",
        source: readFileSync(source, "utf8"),
      });
    },
  };
}

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
    composeFile(),
  ],
  resolve: {
    tsconfigPaths: true,
    // Also for MDX pages, which tsconfig paths do not cover.
    alias: { "@/": `${fileURLToPath(new URL("./app/", import.meta.url))}` },
  },
});
