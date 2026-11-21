import { source } from "@/lib/source";
import { createFromSource } from "fumadocs-core/search/server";

// Built once, at build time, into a static file: the search runs in the browser, with no server behind it.
const server = createFromSource(source, {
  localeMap: {
    pt: { language: "portuguese" },
    en: { language: "english" },
  },
});

export async function loader() {
  return server.staticGET();
}
