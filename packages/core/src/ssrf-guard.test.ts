import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { assertPublicUrl, isPrivateIPv4, isPrivateIPv6, safeFetch } from "./ssrf-guard";

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
    process.env.WEBFROST_ALLOW_PRIVATE_URLS = undefined;
  });

  afterEach(() => {
    process.env.WEBFROST_ALLOW_PRIVATE_URLS = undefined;
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
    process.env.WEBFROST_ALLOW_PRIVATE_URLS = undefined;
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
});

describe("assertPublicUrl", () => {
  beforeEach(() => {
    process.env.WEBFROST_ALLOW_PRIVATE_URLS = undefined;
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
      process.env.WEBFROST_ALLOW_PRIVATE_URLS = undefined;
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
      process.env.WEBFROST_ALLOW_PRIVATE_URLS = undefined;
      process.env.WEBFROST_FETCH_TIMEOUT_MS = undefined;
      server.stop(true);
    }
  });
});
