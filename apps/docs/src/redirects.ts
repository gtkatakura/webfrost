// Pages that moved. Old links (bookmarks, search engines, other sites) get a permanent redirect to the
// new address, and so does the route data React Router fetches for a client-side navigation
// (`<path>.data`), which a page prerendered before the move may still ask for.
const moved: Record<string, string> = {
  "/docs/guides/web-ui": "/docs/reference/web-ui",
  "/docs/guides/authenticated-pages": "/docs/guides/troubleshooting#authenticated-pages",
};

/** The address a request for `path` should be sent to, or null when the page did not move. */
export function redirectFor(path: string): string | null {
  const data = path.endsWith(".data");
  const page = (data ? path.slice(0, -".data".length) : path).replace(/\/+$/, "");
  const target = moved[page];
  if (!target) return null;
  // Route data has no fragment: the page it belongs to scrolls to the anchor itself.
  return data ? `${target.split("#")[0]}.data` : target;
}
