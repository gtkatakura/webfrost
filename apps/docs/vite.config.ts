import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { defineConfig } from "vite";
import { imagetools } from "vite-imagetools";

export default defineConfig({
  // Images are resized, cropped and re-encoded at build time from the masters in app/assets (see
  // components/picture.tsx). The site is prerendered and has no server to do it on request.
  plugins: [imagetools(), fumadocsMdx(), tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
});
