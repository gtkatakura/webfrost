import { type Server, type Socket, createServer, isIP, connect as tcpConnect } from "node:net";
import { assertPublicHost, isPrivateIPv4, isPrivateIPv6 } from "./ssrf-guard";

type Browser = import("playwright").Browser;
type BrowserContext = import("playwright").BrowserContext;
type BrowserContextOptions = import("playwright").BrowserContextOptions;

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
 *
 * These only see what Playwright intercepts. `newGuardedContext` adds the floor
 * under them: an egress proxy that checks every connection (see `startEgressProxy`).
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

/**
 * Resolves `hostname` to the address the browser may connect to, or null to refuse.
 * Returning the address (not a yes/no) lets the proxy connect to exactly the address
 * it checked, so a second DNS lookup cannot rebind the name to a private one.
 */
export type AddressCheck = (hostname: string) => Promise<string | null>;

async function lookupAll(hostname: string): Promise<{ address: string; family: number }[]> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const family = isIP(host);
  if (family) return [{ address: host, family }];
  return Bun.dns.lookup(host, { family: 0 });
}

/** The policy of `assertPublicHost`, applied to the address actually connected to. */
const defaultAddressCheck: AddressCheck = async (hostname) => {
  const results = await lookupAll(hostname);
  if (process.env.WEBFROST_ALLOW_PRIVATE_URLS !== "true") {
    for (const { address, family } of results) {
      if (family === 4 && isPrivateIPv4(address)) return null;
      if (family === 6 && isPrivateIPv6(address)) return null;
    }
  }
  return results[0]?.address ?? null;
};

/** An address check that defers the decision to a hostname check (tests inject one). */
function addressCheckFrom(hostCheck: HostCheck): AddressCheck {
  return async (hostname) => {
    if (!(await hostCheck(hostname).catch(() => false))) return null;
    return (await lookupAll(hostname))[0]?.address ?? null;
  };
}

export interface EgressProxy {
  /** `socks5://127.0.0.1:<port>`, for Playwright's `proxy.server`. */
  server: string;
  close(): Promise<void>;
}

const SOCKS_OK = 0x00;
const SOCKS_NOT_ALLOWED = 0x02;
const SOCKS_REFUSED = 0x05;
const SOCKS_BAD_COMMAND = 0x07;
const SOCKS_BAD_ADDRESS = 0x08;

/** Parse a SOCKS5 CONNECT request: null while incomplete, a reply code when unusable. */
function parseConnect(buf: Buffer): { host: string; port: number; rest: Buffer } | number | null {
  if (buf.length < 5) return null;
  const [ver, cmd, , atyp] = buf;
  let host: string;
  let end: number;
  if (atyp === 0x01) {
    end = 8;
    if (buf.length < end + 2) return null;
    host = [...buf.subarray(4, end)].join(".");
  } else if (atyp === 0x03) {
    end = 5 + (buf[4] ?? 0);
    if (buf.length < end + 2) return null;
    host = buf.subarray(5, end).toString("latin1");
  } else if (atyp === 0x04) {
    end = 20;
    if (buf.length < end + 2) return null;
    const raw = buf.subarray(4, end);
    host = Array.from({ length: 8 }, (_, i) => raw.readUInt16BE(i * 2).toString(16)).join(":");
  } else {
    return SOCKS_BAD_ADDRESS;
  }
  if (ver !== 0x05 || cmd !== 0x01) return SOCKS_BAD_COMMAND;
  return { host, port: buf.readUInt16BE(end), rest: buf.subarray(end + 2) };
}

/**
 * A SOCKS5 proxy on loopback that only opens connections the address check allows.
 *
 * `route()` and `routeWebSocket()` only see what Playwright intercepts: they miss
 * redirect hops, shared workers and WebSockets opened from workers. A browser context
 * whose every connection goes through this proxy cannot reach a blocked address by
 * any of those paths: the check runs on the TCP connection itself, for every hop,
 * from every frame and worker. SOCKS5 tunnels raw TCP, so the proxy never parses
 * HTTP and TLS stays end to end; Chromium sends the hostname, and the proxy connects
 * to the address it checked (no DNS rebinding between check and connect).
 */
export async function startEgressProxy(
  check: AddressCheck = defaultAddressCheck,
): Promise<EgressProxy> {
  const sockets = new Set<Socket>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
  };

  const server: Server = createServer((client) => {
    track(client);
    let buffer = Buffer.alloc(0);
    let greeted = false;
    const reply = (code: number) =>
      client.write(Buffer.from([0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
    const refuse = (code: number) => {
      reply(code);
      client.end();
    };

    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!greeted) {
        const n = buffer[1];
        if (n === undefined || buffer.length < 2 + n) return;
        const methods = buffer.subarray(2, 2 + n);
        if (buffer[0] !== 0x05 || !methods.includes(0x00)) {
          client.end(Buffer.from([0x05, 0xff]));
          return;
        }
        buffer = buffer.subarray(2 + n);
        client.write(Buffer.from([0x05, 0x00])); // no authentication
        greeted = true;
      }
      const request = parseConnect(buffer);
      if (request === null) return;
      client.off("data", onData);
      if (typeof request === "number") return refuse(request);
      client.pause();
      check(request.host)
        .catch(() => null)
        .then((address) => {
          if (client.destroyed) return;
          if (!address) return refuse(SOCKS_NOT_ALLOWED);
          const upstream = tcpConnect({ host: address, port: request.port });
          track(upstream);
          let connected = false;
          upstream.once("connect", () => {
            connected = true;
            reply(SOCKS_OK);
            if (request.rest.length) upstream.write(request.rest);
            client.pipe(upstream);
            upstream.pipe(client);
            client.resume();
          });
          upstream.on("close", (hadError) => {
            // A clean close ends the client after what is still buffered for it.
            if (connected) hadError ? client.destroy() : client.end();
            else if (!client.destroyed) refuse(SOCKS_REFUSED);
          });
          client.on("close", () => upstream.destroy());
        });
    };
    client.on("data", onData);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  let closed: Promise<void> | undefined;
  return {
    server: `socks5://127.0.0.1:${port}`,
    close() {
      closed ??= new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      });
      return closed;
    },
  };
}

/**
 * Open a browser context with the whole SSRF policy applied: every connection goes
 * through an egress proxy that checks the address it connects to, and the context is
 * guarded (route checks, redirect reporting, seal). The proxy stops when the context
 * closes. `hostCheck` replaces the address policy (tests use it to tell fixtures apart).
 */
export async function newGuardedContext(
  browser: Browser,
  options: BrowserContextOptions = {},
  hostCheck?: HostCheck,
): Promise<{ context: BrowserContext; guard: BrowserGuard }> {
  const proxy = await startEgressProxy(hostCheck ? addressCheckFrom(hostCheck) : undefined);
  let context: BrowserContext;
  try {
    context = await browser.newContext({
      // Service workers could issue requests that bypass route(); the archive does not need them.
      serviceWorkers: "block",
      ...options,
      // Playwright adds <-loopback> to the bypass list, so loopback goes through the proxy too.
      proxy: { server: proxy.server },
    });
  } catch (err) {
    await proxy.close();
    throw err;
  }
  context.on("close", () => void proxy.close());
  const guard = await guardBrowserContext(context, hostCheck);
  return { context, guard };
}
