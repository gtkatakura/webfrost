import { glob } from "node:fs/promises";
import type { Config } from "@react-router/dev/config";
import { createGetUrl, getSlugs } from "fumadocs-core/source";

const getUrl = createGetUrl("/docs");

// No server rendering: every page is written to a file at build time, and src/main.ts only hands files out.
export default {
  ssr: false,
  async prerender({ getStaticPaths }) {
    const paths = new Set<string>(getStaticPaths());
    for await (const entry of glob("**/*.{md,mdx}", { cwd: "content/docs" })) {
      paths.add(getUrl(getSlugs(entry)));
    }
    return [...paths];
  },
} satisfies Config;
