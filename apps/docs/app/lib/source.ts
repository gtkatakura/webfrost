import { loader } from "fumadocs-core/source";
import { defineDocs } from "fumadocs-mdx/macro";
import { iconsPlugin } from "./icons";
import { docsRoute } from "./shared";
import { hiddenDocs } from "./unpublished";

export const docs = defineDocs({
  dir: "content/docs",
  docs: { async: true },
});

// Pages hidden until their release (see unpublished.ts) are left out of the site entirely.
const all = docs.toFumadocsSource();
const visible = { ...all, files: all.files.filter((file) => !hiddenDocs.has(file.path)) };

export const source = loader({
  source: visible,
  baseUrl: docsRoute,
  plugins: [iconsPlugin],
});
