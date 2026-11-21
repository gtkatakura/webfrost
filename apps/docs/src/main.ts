// Hands out the files `react-router build` wrote to build/client. No rendering happens here: every page
// was written at build time. Used to preview the built site (`bun run start`) and to serve it anywhere Bun runs.
import { join, normalize } from "node:path";

const root = join(import.meta.dir, "../build/client");

async function file(path: string): Promise<Response | null> {
  // Never outside the build directory, whatever the address says.
  const full = normalize(join(root, path));
  if (!full.startsWith(root)) return null;
  const f = Bun.file(full);
  if (!(await f.exists()) || (await f.stat()).isDirectory()) return null;
  // Files under /assets carry a hash of their content in the name, so they never change.
  const cache = path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
  return new Response(f, {
    headers: { "cache-control": cache, "x-content-type-options": "nosniff" },
  });
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 5175),
  async fetch(req) {
    if (req.method !== "GET" && req.method !== "HEAD")
      return new Response("Method not allowed", { status: 405 });
    const path = decodeURIComponent(new URL(req.url).pathname);
    const clean = path.replace(/\/+$/, "");
    return (
      (await file(path)) ??
      (await file(`${clean}/index.html`)) ??
      new Response(Bun.file(join(root, "__spa-fallback.html")), {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    );
  },
});

console.log(`WebFrost docs on http://localhost:${server.port}`);
