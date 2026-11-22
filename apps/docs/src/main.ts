// Hands out the files `react-router build` wrote to build/client. No rendering happens here: every page
// was written at build time. Runs the published site (apps/docs/Dockerfile) and `bun run start` locally.
import { join, normalize } from "node:path";
import { redirectFor } from "./redirects";

const root = join(import.meta.dir, "../build/client");

// Sent with every response. The pages carry React Router's inline hydration scripts, so there is no
// script-src policy yet; framing and content sniffing are shut off.
const securityHeaders = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

// The install scripts (`curl | sh`, `irm | iex`) and the Compose file (`curl -fsSLO …/compose.yml`):
// served as plain text, so a browser shows them instead of downloading them, and kept for a minute
// only, so a fix reaches users quickly.
const installScripts = new Set(["/install.sh", "/compose.yml"]);

function cacheControl(path: string): string {
  if (installScripts.has(path)) return "public, max-age=60";
  // Files under /assets carry a hash of their content in the name, so they never change: browsers and
  // Cloudflare may keep them for a year.
  if (path.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  // Pages and their route data (`.data`, fetched on client-side navigation and prefetched when a link
  // is hovered): a minute, so the prefetched copy serves the click, and a deploy shows up within it.
  if (path.endsWith(".html") || path.endsWith(".data")) {
    return "public, max-age=60, stale-while-revalidate=600";
  }
  // Everything else in public/ (the favicon): a day.
  return "public, max-age=86400";
}

async function file(path: string): Promise<Response | null> {
  // Never outside the build directory, whatever the address says.
  const full = normalize(join(root, path));
  if (!full.startsWith(root)) return null;
  const f = Bun.file(full);
  if (!(await f.exists()) || (await f.stat()).isDirectory()) return null;
  const headers: Record<string, string> = {
    ...securityHeaders,
    "cache-control": cacheControl(path),
  };
  if (installScripts.has(path)) headers["content-type"] = "text/plain; charset=utf-8";
  return new Response(f, { headers });
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 5175),
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    // Health check for a reverse proxy or the container runtime.
    if (path === "/up") return new Response("ok");
    if (req.method !== "GET" && req.method !== "HEAD")
      return new Response("Method not allowed", { status: 405 });
    // Pages that moved: a permanent redirect, so links and search engines follow.
    const moved = redirectFor(path);
    if (moved) {
      return new Response(null, {
        status: 301,
        headers: { ...securityHeaders, location: moved, "cache-control": "public, max-age=86400" },
      });
    }
    const clean = path.replace(/\/+$/, "");
    return (
      (await file(path)) ??
      (await file(`${clean}/index.html`)) ??
      new Response(Bun.file(join(root, "__spa-fallback.html")), {
        status: 404,
        headers: { ...securityHeaders, "content-type": "text/html; charset=utf-8" },
      })
    );
  },
});

console.log(`WebFrost docs on http://localhost:${server.port}`);
