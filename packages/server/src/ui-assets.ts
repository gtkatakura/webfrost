import { existsSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
  ".webmanifest": "application/manifest+json",
};

export function mimeTypeFor(pathname: string): string {
  return MIME_TYPES[extname(pathname)] ?? "application/octet-stream";
}

/** A source of the web UI's static files (a directory, or files embedded in the binary). */
export interface UiAssets {
  /** The file for a URL path such as "/assets/app.js", or null when there is none. */
  find(pathname: string): Promise<Blob | null>;
}

/** Serve the UI from a directory on disk. Paths that escape the directory are not found. */
export function directoryAssets(root: string): UiAssets {
  const base = resolve(root);
  return {
    async find(pathname) {
      const filePath = resolve(base, pathname.startsWith("/") ? pathname.slice(1) : pathname);
      if (!filePath.startsWith(base + sep)) return null;
      const file = Bun.file(filePath);
      return (await file.exists()) ? file : null;
    },
  };
}

/**
 * Serve the UI from files embedded in a compiled binary. `files` maps URL paths
 * ("/index.html", "/assets/app.js") to the path Bun gives the embedded file.
 */
export function embeddedAssets(files: Record<string, string>): UiAssets {
  return {
    async find(pathname) {
      const path = Object.hasOwn(files, pathname) ? files[pathname] : undefined;
      return path ? Bun.file(path) : null;
    },
  };
}

/** The UI directory of a monorepo checkout, or `./public` (the Docker image), when present. */
export function defaultUiAssets(): UiAssets | null {
  const uiDistPath = resolve(import.meta.dir, "../../ui/dist");
  const fallbackPublicPath = resolve(process.cwd(), "public");
  if (existsSync(uiDistPath)) return directoryAssets(uiDistPath);
  if (existsSync(fallbackPublicPath)) return directoryAssets(fallbackPublicPath);
  return null;
}
