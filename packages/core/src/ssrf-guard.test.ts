import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  ResponseTooLargeError,
  assertPublicUrl,
  fetchGuarded,
  isPrivateIPv4,
  isPrivateIPv6,
  safeFetch,
} from "./ssrf-guard";

// ---------------------------------------------------------------------------
// IP classification helpers
// ---------------------------------------------------------------------------

describe("isPrivateIPv4", () => {
  test.each([
    ["127.0.0.1", true], // loopback
    ["127.255.255.255", true], // loopback range
    ["10.0.0.1", true], // 10/8 private
    ["10.255.255.255", true],
    ["172.16.0.1", true], // 172.16/12 private
    ["172.31.255.255", true],
    ["192.168.0.1", true], // 192.168/16 private
    ["169.254.169.254", true], // link-local (AWS metadata)
    ["0.0.0.0", true], // "this" network
    ["255.255.255.255", true], // broadcast / reserved >= 240
    ["8.8.8.8", false], // Google DNS — public
    ["1.1.1.1", false], // Cloudflare — public
    ["172.15.255.255", false], // just outside 172.16/12
    ["172.32.0.0", false], // just outside 172.16/12
    ["192.169.0.1", false], // not 192.168
  ])("isPrivateIPv4(%s) === %s", (ip, expected) => {
    expect(isPrivateIPv4(ip)).toBe(expected);
  });
});

describe("isPrivateIPv6", () => {
  test.each([
    ["::1", true], // loopback
    ["0:0:0:0:0:0:0:1", true], // loopback long form
    ["::", true], // unspecified
    ["fc00::1", true], // fc00::/7 unique-local
    ["fd12:3456:789a:1::1", true], // fd unique-local
    ["fe80::1", true], // link-local
    ["::ffff:127.0.0.1", true], // IPv4-mapped loopback
    ["::ffff:10.0.0.1", true], // IPv4-mapped private
    ["::ffff:192.168.1.1", true], // IPv4-mapped private
    ["2001:db8::1", false], // documentation — public
    ["2606:4700:4700::1111", false], // Cloudflare — public
    ["::ffff:8.8.8.8", false], // IPv4-mapped public
  ])("isPrivateIPv6(%s) === %s", (ip, expected) => {
    expect(isPrivateIPv6(ip)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// safeFetch — SSRF blocking
// ---------------------------------------------------------------------------

describe("safeFetch SSRF protection", () => {
  beforeEach(() => {
    Reflect.deleteProperty(process.env, "WEBFROST_ALLOW_PRIVATE_URLS");
  });

  afterEach(() => {
    Reflect.deleteProperty(process.env, "WEBFROST_ALLOW_PRIVATE_URLS");
  });

  test("blocks loopback IP", async () => {
    await expect(safeFetch("http://127.0.0.1/")).rejects.toThrow("SSRF blocked");
  });

  test("blocks link-local IP (AWS metadata endpoint)", async () => {
    await expect(safeFetch("http://169.254.169.254/")).rejects.toThrow("SSRF blocked");
  });

  test("blocks localhost hostname", async () => {
    await expect(safeFetch("http://localhost/")).rejects.toThrow("SSRF blocked");
  });

  test("allows private URLs when WEBFROST_ALLOW_PRIVATE_URLS=true", async () => {
    process.env.WEBFROST_ALLOW_PRIVATE_URLS = "true";

    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("ok"),
    });

    try {
      const res = await safeFetch(`http://localhost:${server.port}/`);
      expect(res.status).toBe(200);
    } finally {
      server.stop(true);
    }
  });
});

// ---------------------------------------------------------------------------
// safeFetch — 50 MB response cap
// ---------------------------------------------------------------------------

describe("safeFetch response size cap", () => {
  beforeEach(() => {
    process.env.WEBFROST_ALLOW_PRIVATE_URLS = "true";
  });

  afterEach(() => {
    Reflect.deleteProperty(process.env, "WEBFROST_ALLOW_PRIVATE_URLS");
  });

  test("rejects response whose streamed body exceeds 50 MB", async () => {
    // Stream 50 MB + 1 byte via a ReadableStream so Bun reports the correct content-length
    const limit = 50 * 1024 * 1024;
    const body = new Uint8Array(limit + 1).fill(65); // 'A' × (50MB+1)
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response(body),
    });

    try {
      await expect(safeFetch(`http://localhost:${server.port}/`)).rejects.toThrow(
        "Response too large",
      );
    } finally {
      server.stop(true);
    }
  });

  test("accepts response within size limit", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("hello world"),
    });

    try {
      const res = await safeFetch(`http://localhost:${server.port}/`);
      expect(await res.text()).toBe("hello world");
    } finally {
      server.stop(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Ranges and encodings that used to slip through
// ---------------------------------------------------------------------------

describe("reserved ranges", () => {
  test.each([
    ["100.64.0.1", true], // carrier-grade NAT
    ["100.127.255.254", true],
    ["100.128.0.1", false],
    ["192.0.0.8", true], // IETF protocol assignments
    ["198.18.0.1", true], // benchmarking
    ["198.19.255.255", true],
    ["198.20.0.1", false],
    ["224.0.0.1", true], // multicast
    ["239.255.255.250", true],
    ["8.8.8.8", false],
  ])("isPrivateIPv4(%s) = %s", (ip, expected) => {
    expect(isPrivateIPv4(ip)).toBe(expected);
  });

  test.each([
    ["::ffff:7f00:1", true], // 127.0.0.1 in the hex form the URL parser produces
    ["::ffff:a9fe:a9fe", true], // 169.254.169.254
    ["::ffff:808:808", false], // 8.8.8.8
    ["[::1]", true], // bracketed, as returned by URL.hostname
    ["64:ff9b::7f00:1", true], // NAT64 → 127.0.0.1
    ["64:ff9b::808:808", false],
    ["fec0::1", true], // deprecated site-local
    ["ff02::1", true], // multicast
    ["2606:4700:4700::1111", false],
  ])("isPrivateIPv6(%s) = %s", (ip, expected) => {
    expect(isPrivateIPv6(ip)).toBe(expected);
  });

  test.each([
    ["::127.0.0.1", true], // deprecated IPv4-compatible, as glibc prints it
    ["::7f00:1", true],
    ["::8.8.8.8", true], // the whole ::/96 is refused
    ["::ffff:0:7f00:1", true], // IPv4-translated (::ffff:0:0:0/96) → 127.0.0.1
    ["::ffff:0:10.0.0.1", true],
    ["::ffff:0:808:808", false],
    ["0:0:0:0:0:ffff:7f00:1", true], // mapped, long form
    ["::ffff:127.0.0.1%eth0", true], // zone ID
    ["64:ff9b::10.0.0.1", true], // NAT64, dotted tail
    ["64:ff9b:1::a00:1", true], // local-use NAT64 (64:ff9b:1::/48)
    ["2002:7f00:1::1", true], // 6to4 → 127.0.0.1
    ["2002:a9fe:a9fe::", true], // 6to4 → 169.254.169.254
    ["2002:808:808::1", false], // 6to4 → 8.8.8.8
    ["2001:0:4136:e378:8000:63bf:3fff:fdd2", true], // Teredo
    ["100::1", true], // discard-only
    ["4000::1", true], // outside 2000::/3
    ["2a00:1450:4001:82a::200e", false],
    ["not-an-address", true], // unparseable fails closed
    ["1:2:3:4:5:6:7:8:9", true],
  ])("isPrivateIPv6(%s) = %p (embedded IPv4 and allowlist)", (ip, expected) => {
    expect(isPrivateIPv6(ip)).toBe(expected);
  });
});

describe("fetchGuarded address pinning (DNS rebinding)", () => {
  let lookups = 0;
  let calls: { url: string; init: Record<string, unknown> }[] = [];
  let refuse = new Set<string>();

  beforeEach(() => {
    Reflect.deleteProperty(process.env, "WEBFROST_ALLOW_PRIVATE_URLS");
    lookups = 0;
    calls = [];
    refuse = new Set();
    // A rebinding resolver: public addresses the first time, the metadata endpoint after.
    spyOn(Bun.dns, "lookup").mockImplementation((async () => {
      lookups++;
      return lookups === 1
        ? [
            { address: "203.0.113.7", family: 4, ttl: 0 },
            { address: "2606:4700::6810:84e5", family: 6, ttl: 0 },
          ]
        : [{ address: "169.254.169.254", family: 4, ttl: 0 }];
    }) as unknown as typeof Bun.dns.lookup);
    spyOn(globalThis, "fetch").mockImplementation((async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init: init as Record<string, unknown> });
      if (refuse.has(new URL(String(url)).hostname)) throw new Error("ECONNREFUSED");
      return new Response("pinned");
    }) as unknown as typeof fetch);
  });

  afterEach(() => {
    mock.restore();
  });

  test("connects to the checked address with the original Host and TLS server name", async () => {
    const res = await fetchGuarded("https://rebind.example:8443/page?q=1");
    expect(new TextDecoder().decode(res.body)).toBe("pinned");
    expect(res.url).toBe("https://rebind.example:8443/page?q=1");
    expect(lookups).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://203.0.113.7:8443/page?q=1");
    expect(calls[0]?.init.headers).toEqual({ host: "rebind.example:8443" });
    expect(calls[0]?.init.tls).toEqual({ serverName: "rebind.example" });
  });

  test("falls back to the next checked address when one refuses the connection", async () => {
    refuse.add("203.0.113.7");
    const res = await fetchGuarded("http://rebind.example/");
    expect(new TextDecoder().decode(res.body)).toBe("pinned");
    expect(calls.map((c) => c.url)).toEqual([
      "http://203.0.113.7/",
      "http://[2606:4700::6810:84e5]/",
    ]);
    expect(calls[1]?.init.tls).toBeUndefined();
    expect(lookups).toBe(1);
  });

  test("an error from the pinned connection names the hostname, not the address", async () => {
    spyOn(globalThis, "fetch").mockImplementation((async (url: string) => {
      throw new Error(`ERR_TLS_CERT_ALTNAME_INVALID fetching "${url}" (${new URL(url).host})`);
    }) as unknown as typeof fetch);
    const err = await fetchGuarded("https://rebind.example:8443/page").catch((e: unknown) => e);
    const message = (err as Error).message;
    expect(message).toContain('fetching "https://rebind.example:8443/page"');
    expect(message).toContain("(rebind.example:8443)");
    expect(message).not.toContain("2606:4700");
    expect(message).not.toContain("203.0.113.7");
  });
});

describe("fetchGuarded maxBytes", () => {
  beforeEach(() => {
    process.env.WEBFROST_ALLOW_PRIVATE_URLS = "true";
  });
  afterEach(() => {
    Reflect.deleteProperty(process.env, "WEBFROST_ALLOW_PRIVATE_URLS");
  });

  test("refuses a larger Content-Length before reading the body", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response(new Uint8Array(5000)) });
    try {
      const err = await fetchGuarded(`http://localhost:${server.port}/`, { maxBytes: 100 }).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ResponseTooLargeError);
      expect((err as Error).message).toContain("content-length=5000, max=100");
    } finally {
      server.stop(true);
    }
  });

  test("stops a chunked body that outgrows the cap, and accepts one within it", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        const size = new URL(req.url).pathname === "/big" ? 5000 : 50;
        return new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(size));
              c.close();
            },
          }),
        );
      },
    });
    try {
      const base = `http://localhost:${server.port}`;
      const err = await fetchGuarded(`${base}/big`, { maxBytes: 100 }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ResponseTooLargeError);
      expect((await fetchGuarded(`${base}/small`, { maxBytes: 100 })).body.byteLength).toBe(50);
    } finally {
      server.stop(true);
    }
  });
});

describe("fetchGuarded 3xx handling", () => {
  test.each([
    [304, null],
    [300, null],
    [300, "/elsewhere"], // 300 is not a redirect status, even with a Location
    [302, null],
  ])("returns %i (Location: %p) as the final response", async (status, location) => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname === "/elsewhere") return new Response("followed");
        const headers: Record<string, string> = location ? { location } : {};
        return new Response(status === 304 ? null : "as received", { status, headers });
      },
    });
    process.env.WEBFROST_ALLOW_PRIVATE_URLS = "true";
    try {
      const url = `http://127.0.0.1:${server.port}/page`;
      const res = await fetchGuarded(url);
      expect(res.status).toBe(status);
      expect(res.url).toBe(url);
      expect(res.redirects).toEqual([]);
      expect(new TextDecoder().decode(res.body)).toBe(status === 304 ? "" : "as received");
      expect((await safeFetch(url)).status).toBe(status);
    } finally {
      Reflect.deleteProperty(process.env, "WEBFROST_ALLOW_PRIVATE_URLS");
      server.stop(true);
    }
  });
});

describe("assertPublicUrl", () => {
  beforeEach(() => {
    Reflect.deleteProperty(process.env, "WEBFROST_ALLOW_PRIVATE_URLS");
  });

  test.each([
    "file:///etc/passwd",
    "ftp://example.com/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://2130706433/", // decimal 127.0.0.1
    "http://0x7f.1/", // hex 127.0.0.1
    "not a url",
  ])("rejects %s", async (url) => {
    await expect(assertPublicUrl(url)).rejects.toThrow();
  });

  test("lets private addresses through when explicitly allowed", async () => {
    process.env.WEBFROST_ALLOW_PRIVATE_URLS = "true";
    try {
      await expect(assertPublicUrl("http://127.0.0.1/")).resolves.toBeUndefined();
      // The protocol restriction is not part of the opt-out.
      await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow("unsupported protocol");
    } finally {
      Reflect.deleteProperty(process.env, "WEBFROST_ALLOW_PRIVATE_URLS");
    }
  });
});

describe("safeFetch timeout", () => {
  test("aborts a response that never arrives", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch() {
        await Bun.sleep(2000);
        return new Response("late");
      },
    });
    process.env.WEBFROST_ALLOW_PRIVATE_URLS = "true";
    process.env.WEBFROST_FETCH_TIMEOUT_MS = "100";
    try {
      await expect(safeFetch(`http://127.0.0.1:${server.port}/`)).rejects.toThrow("timed out");
    } finally {
      Reflect.deleteProperty(process.env, "WEBFROST_ALLOW_PRIVATE_URLS");
      Reflect.deleteProperty(process.env, "WEBFROST_FETCH_TIMEOUT_MS");
      server.stop(true);
    }
  });
});

describe("safeFetch cancellation", () => {
  test("aborting the signal cancels a request in flight with the abort reason", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch() {
        await Bun.sleep(3000);
        return new Response("late");
      },
    });
    process.env.WEBFROST_ALLOW_PRIVATE_URLS = "true";
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error("extractor gave up")), 100);
      const start = Date.now();
      await expect(
        safeFetch(`http://127.0.0.1:${server.port}/`, { signal: controller.signal }),
      ).rejects.toThrow("extractor gave up");
      expect(Date.now() - start).toBeLessThan(2000);
    } finally {
      Reflect.deleteProperty(process.env, "WEBFROST_ALLOW_PRIVATE_URLS");
      server.stop(true);
    }
  });

  test("fetchGuarded reports the redirect chain and the final URL", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === "/a") {
          return new Response("moved", { status: 301, headers: { location: "/b" } });
        }
        if (pathname === "/b") {
          return new Response(null, { status: 302, headers: { location: "/c" } });
        }
        return new Response("final");
      },
    });
    process.env.WEBFROST_ALLOW_PRIVATE_URLS = "true";
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const res = await fetchGuarded(`${base}/a`);
      expect(res.requestedUrl).toBe(`${base}/a`);
      expect(res.url).toBe(`${base}/c`);
      expect(res.redirects.map((r) => [r.status, r.url])).toEqual([
        [301, `${base}/a`],
        [302, `${base}/b`],
      ]);
      expect(new TextDecoder().decode(res.redirects[0]?.body)).toBe("moved");
      expect(new TextDecoder().decode(res.body)).toBe("final");
    } finally {
      Reflect.deleteProperty(process.env, "WEBFROST_ALLOW_PRIVATE_URLS");
      server.stop(true);
    }
  });
});
