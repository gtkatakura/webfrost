import { assertPublicHost } from "./ssrf-guard";

type BrowserContext = import("playwright").BrowserContext;

/** Decides whether the browser may talk to `hostname`. Rejects (or resolves false) to block. */
export type HostCheck = (hostname: string) => Promise<boolean>;

const defaultHostCheck: HostCheck = (hostname) =>
  assertPublicHost(hostname).then(
    () => true,
    () => false,
  );

export interface BrowserGuard {
  /**
   * Resolves once every request seen so far has been checked. Returns the first
   * URL that reached a blocked host through a redirect, or null if none did.
   */
  violation(): Promise<string | null>;
  /**
   * Refuse every further request, then report violations. Call this after the page
   * has loaded and before capturing it: from here on the page cannot issue any
   * request, so a script that waits and then redirects a frame to an internal
   * host cannot get that response into the screenshot, PDF or DOM snapshot.
   */
  seal(): Promise<string | null>;
}

/**
 * Apply the SSRF policy to everything a browser context loads: the navigation
 * itself, subresources, iframes, fetch/XHR and WebSockets.
 *
 * `safeFetch` only protects the first HTTP request of a snapshot. Without this
 * guard the page could still make Chromium load `http://169.254.169.254/` (or any
 * intranet host) in an iframe or image and have it captured in the screenshot,
 * PDF or DOM snapshot.
 *
 * Three layers:
 * 1. `context.route()` aborts every request whose host is not public.
 * 2. Playwright cannot intercept redirect hops, so those are checked from the
 *    `request` event instead. A blocked hop cannot be stopped mid-flight, but it
 *    is reported through `violation()` so the caller can refuse to capture the page.
 * 3. `seal()` refuses every request once the page has loaded, closing the window
 *    in which a late redirect could slip in between the check and the capture.
 */
export async function guardBrowserContext(
  context: BrowserContext,
  hostCheck: HostCheck = defaultHostCheck,
): Promise<BrowserGuard> {
  // One DNS verdict per host per context — pages routinely make dozens of requests per origin.
  const verdicts = new Map<string, Promise<boolean>>();

  function isAllowed(rawUrl: string): Promise<boolean> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return Promise.resolve(false);
    }
    // Never leave the browser: these are resolved in-process.
    if (["data:", "blob:", "about:"].includes(parsed.protocol)) return Promise.resolve(true);
    if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol)) {
      return Promise.resolve(false);
    }
    const host = parsed.hostname;
    let verdict = verdicts.get(host);
    if (!verdict) {
      verdict = hostCheck(host).catch(() => false);
      verdicts.set(host, verdict);
    }
    return verdict;
  }

  const pending = new Set<Promise<void>>();
  let violationUrl: string | null = null;
  // Once sealed, every new request is refused, whatever its destination.
  let sealed = false;

  context.on("request", (request) => {
    // First hops go through route() below; only redirect hops need this path.
    if (!request.redirectedFrom()) return;
    const url = request.url();
    const check = isAllowed(url).then((ok) => {
      if (!ok) violationUrl ??= url;
    });
    pending.add(check);
    check.finally(() => pending.delete(check));
  });

  await context.route("**/*", async (route) => {
    if (!sealed && (await isAllowed(route.request().url()))) {
      await route.continue();
    } else {
      await route.abort("blockedbyclient");
    }
  });

  await context.routeWebSocket(/.*/, async (ws) => {
    if (!sealed && (await isAllowed(ws.url()))) {
      ws.connectToServer();
    } else {
      await ws.close({ code: 1008, reason: "blocked" });
    }
  });

  async function violation(): Promise<string | null> {
    while (pending.size > 0) await Promise.all([...pending]);
    return violationUrl;
  }

  return {
    violation,
    async seal(): Promise<string | null> {
      // The route handler is what actually enforces this: it sees the first hop of
      // every request, and with no first hop there is no redirect to follow.
      // Offline emulation is a second layer only — it does not cover every kind of
      // request in every Chromium build (loopback is exempt in some).
      sealed = true;
      await context.setOffline(true).catch(() => {});
      return violation();
    },
  };
}
