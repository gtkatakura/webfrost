// Hands out the files `react-router build` wrote to build/client. No rendering happens here: every page
// was written at build time. Runs the published site (apps/docs/Dockerfile) and `bun run start` locally.
import { join, normalize } from "node:path";

const root = join(import.meta.dir, "../build/client");

// Sent with every response. The pages carry React Router's inline hydration scripts, so there is no
// script-src policy yet; framing and content sniffing are shut off.
const securityHeaders = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

async function file(path: string): Promise<Response | null> {
  // Never outside the build directory, whatever the address says.
  const full = normalize(join(root, path));
  if (!full.startsWith(root)) return null;
  const f = Bun.file(full);
  if (!(await f.exists()) || (await f.stat()).isDirectory()) return null;
  // Files under /assets carry a hash of their content in the name, so they never change: browsers and
  // Cloudflare may keep them for a year. Pages are revalidated, so a deploy shows up at once.
  const cache = path.startsWith("/assets/")
    ? "public, max-age=31536000, immutable"
    : "public, max-age=0, must-revalidate";
  return new Response(f, { headers: { ...securityHeaders, "cache-control": cache } });
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 5175),
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    if (path === "/up") return new Response("ok");
    if (req.method !== "GET" && req.method !== "HEAD")
      return new Response("Method not allowed", { status: 405 });
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
