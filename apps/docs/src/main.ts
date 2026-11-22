// Hands out the files `react-router build` wrote to build/client. No rendering happens here: every page
// was written at build time. Runs the published site (apps/docs/Dockerfile) and `bun run start` locally.
import { join, normalize } from "node:path";
import { redirectFor } from "./redirects";

const root = join(import.meta.dir, "../build/client");

// Sent with every response: framing and content sniffing are shut off. Pages also get a
// Content-Security-Policy (pageHeaders).
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

// RFC 9116: where to report a vulnerability. Reports go to GitHub's private vulnerability reporting,
// as SECURITY.md says, or to security@webfrost.dev. Built per request so Expires (required) always lies a year ahead.
function securityTxt(): Response {
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const body = [
    "Contact: https://github.com/gtkatakura/webfrost/security/advisories/new",
    "Contact: mailto:security@webfrost.dev",
    `Expires: ${expires}`,
    "Policy: https://github.com/gtkatakura/webfrost/blob/main/SECURITY.md",
    "Preferred-Languages: en, pt",
    "Canonical: https://webfrost.dev/.well-known/security.txt",
    "",
  ].join("\n");
  return new Response(body, {
    headers: {
      ...securityHeaders,
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}

// Each page's Content-Security-Policy, worked out at build time (scripts/csp.ts).
const policies: Record<string, string> = await Bun.file(join(root, "../csp.json"))
  .json()
  .catch(() => {
    throw new Error("build/csp.json is missing: run `bun run build`");
  });

function page(full: string, init: { status?: number; headers: Record<string, string> }): Response {
  const policy = policies[full.slice(root.length)];
  if (!policy) throw new Error(`no Content-Security-Policy for ${full}: run \`bun run build\``);
  return new Response(Bun.file(full), {
    status: init.status,
    headers: {
      ...init.headers,
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": policy,
    },
  });
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
  if (full.endsWith(".html")) return page(full, { headers });
  return new Response(f, { headers });
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 5175),
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    // Health check for a reverse proxy or the container runtime.
    if (path === "/up") return new Response("ok");
    if (path === "/.well-known/security.txt") return securityTxt();
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
      page(join(root, "__spa-fallback.html"), { status: 404, headers: { ...securityHeaders } })
    );
  },
});

console.log(`WebFrost docs on http://localhost:${server.port}`);
