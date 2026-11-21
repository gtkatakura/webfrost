import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import type { Browser } from "playwright";
import { type HostCheck, guardBrowserContext } from "./browser-guard";
import { chromiumLaunchOptions } from "./pipeline";

/**
 * These tests drive a real Chromium. Two loopback servers stand in for the
 * outside world and the intranet, told apart by hostname through an injected
 * host check:
 *   - `127.0.0.1`  → the "public" site being archived
 *   - `localhost`  → the "internal" service that must never be reached
 *
 * They are skipped when no Chromium is available: install one with
 * `bunx playwright install chromium` or point WEBFROST_CHROMIUM_PATH at a system binary.
 */
const { chromium } = await import("playwright");
const chromiumInstalled = (() => {
  try {
    return existsSync(chromiumLaunchOptions().executablePath ?? chromium.executablePath());
  } catch {
    return false;
  }
})();

const allowOnlyPublicFixture: HostCheck = async (hostname) => hostname === "127.0.0.1";

let browser: Browser;
let site: ReturnType<typeof Bun.serve>;
let internal: ReturnType<typeof Bun.serve>;
let internalHits: string[] = [];

beforeAll(async () => {
  if (!chromiumInstalled) return;
  browser = await chromium.launch(chromiumLaunchOptions());

  internal = Bun.serve({
    port: 0,
    fetch(req) {
      internalHits.push(new URL(req.url).pathname);
      return new Response("<html><body>TOP-SECRET-INTERNAL</body></html>", {
        headers: { "content-type": "text/html", "access-control-allow-origin": "*" },
      });
    },
  });
  const internalOrigin = `http://localhost:${internal.port}`;

  site = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      const html = (body: string) =>
        new Response(`<html><body><h1>public</h1>${body}</body></html>`, {
          headers: { "content-type": "text/html" },
        });
      switch (pathname) {
        case "/clean":
          return html("<p>nothing to see</p>");
        case "/iframe":
          return html(`<iframe src="${internalOrigin}/frame"></iframe>`);
        case "/fetch":
          return html(
            `<script>fetch("${internalOrigin}/xhr").then(r => r.text()).then(t => { document.title = t }).catch(() => { document.title = "blocked" })</script>`,
          );
        case "/late-redirect":
          // Behaves until well after the load event, then pulls the internal host into a frame.
          return html(
            `<script>setTimeout(() => { const f = document.createElement("iframe"); f.src = "/hop"; document.body.appendChild(f); }, 400)</script>`,
          );
        case "/redirect-sub":
          return html(`<iframe src="/hop"></iframe>`);
        case "/hop":
          return Response.redirect(`${internalOrigin}/via-redirect`, 302);
        case "/redirect-main":
          return Response.redirect(`${internalOrigin}/main-redirect`, 302);
        default:
          return new Response("not found", { status: 404 });
      }
    },
  });
});

afterAll(async () => {
  await browser?.close();
  site?.stop(true);
  internal?.stop(true);
});

async function visit(path: string, { seal = false } = {}) {
  internalHits = [];
  const context = await browser.newContext({ serviceWorkers: "block" });
  const guard = await guardBrowserContext(context, allowOnlyPublicFixture);
  const page = await context.newPage();
  let navigationError: string | null = null;
  let sealed: string | null = null;
  try {
    await page.goto(`http://127.0.0.1:${site.port}${path}`, { waitUntil: "load", timeout: 15_000 });
    // What the pipeline does: cut the network as soon as the page has loaded…
    if (seal) sealed = await guard.seal();
    // …and only then spend time capturing it.
    await page.waitForTimeout(seal ? 1200 : 300);
  } catch (err) {
    navigationError = err instanceof Error ? err.message : String(err);
  }
  const violation = sealed ?? (await guard.violation());
  const frames = await Promise.all(page.frames().map((f) => f.content().catch(() => "")));
  const title = await page.title().catch(() => "");
  await context.close();
  return { violation, navigationError, content: frames.join("\n"), title };
}

describe.skipIf(!chromiumInstalled)("guardBrowserContext", () => {
  test("a page that only talks to public hosts loads untouched", async () => {
    const { violation, navigationError, content } = await visit("/clean");
    expect(navigationError).toBeNull();
    expect(violation).toBeNull();
    expect(content).toContain("nothing to see");
    expect(internalHits).toEqual([]);
  });

  test("an iframe pointing at an internal host is never requested", async () => {
    const { content, violation } = await visit("/iframe");
    expect(internalHits).toEqual([]);
    expect(content).not.toContain("TOP-SECRET-INTERNAL");
    expect(violation).toBeNull();
  });

  test("fetch() to an internal host is blocked", async () => {
    const { title } = await visit("/fetch");
    expect(internalHits).toEqual([]);
    expect(title).toBe("blocked");
  });

  test("a subresource redirected to an internal host is reported as a violation", async () => {
    // Redirect hops cannot be intercepted, so the pipeline relies on this signal to
    // refuse to capture the page.
    const { violation } = await visit("/redirect-sub");
    expect(violation).toContain("/via-redirect");
  });

  test("without seal(), a redirect that fires after load reaches the internal host", async () => {
    // This is the hole seal() exists for: the check right after load sees nothing,
    // and the frame is filled with internal content a moment later.
    const context = await browser.newContext({ serviceWorkers: "block" });
    const guard = await guardBrowserContext(context, allowOnlyPublicFixture);
    const page = await context.newPage();
    internalHits = [];
    await page.goto(`http://127.0.0.1:${site.port}/late-redirect`, { waitUntil: "load" });
    expect(await guard.violation()).toBeNull();
    await page.waitForTimeout(1200);
    expect(internalHits).toEqual(["/via-redirect"]);
    await context.close();
  });

  test("seal() stops a page from reaching an internal host after it has loaded", async () => {
    const { content, navigationError } = await visit("/late-redirect", { seal: true });
    expect(navigationError).toBeNull();
    expect(internalHits).toEqual([]);
    expect(content).not.toContain("TOP-SECRET-INTERNAL");
    expect(content).toContain("public");
  });

  test("a navigation redirected to an internal host is reported as a violation", async () => {
    const { violation } = await visit("/redirect-main");
    expect(violation).toContain("/main-redirect");
  });
});
