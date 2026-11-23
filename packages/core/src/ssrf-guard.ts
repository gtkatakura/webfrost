/**
 * SSRF guard — validates URLs before fetching to prevent Server-Side Request Forgery.
 *
 * Resolves each hostname via DNS and rejects private/loopback IPs on every request
 * hop. Set WEBFROST_ALLOW_PRIVATE_URLS=true to opt out (e.g. for intranet archiving).
 *
 * `fetchGuarded` connects to the addresses it checked (Host header and TLS server name
 * kept), so DNS rebinding cannot swap the address between check and connect. Chromium
 * resolves names on its own, so the browser guard still has that gap: deployments that
 * archive untrusted URLs should also block private ranges at the network layer (see
 * apps/docs/content/docs/architecture/security.mdx).
 */

import { isIP } from "node:net";

const MAX_RESPONSE_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_REDIRECTS = 5;
/** Redirect bodies are kept for the WARC; anything bigger than this is dropped. */
const MAX_REDIRECT_BODY_BYTES = 1024 * 1024;
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

/** Parse a positive integer env var, falling back to `fallback`. */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** Returns true if the dotted-decimal IPv4 address falls in a private/reserved range. */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  // length is 4 so indices 0 and 1 are always defined
  // biome-ignore lint/style/noNonNullAssertion: guarded by length check above
  const a = parts[0]!;
  // biome-ignore lint/style/noNonNullAssertion: guarded by length check above
  const b = parts[1]!;
  // biome-ignore lint/style/noNonNullAssertion: guarded by length check above
  const c = parts[2]!;
  return (
    a === 0 || // 0.0.0.0/8 — "this" network
    a === 10 || // 10.0.0.0/8 — private
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 — carrier-grade NAT
    a === 127 || // 127.0.0.0/8 — loopback
    (a === 169 && b === 254) || // 169.254.0.0/16 — link-local (cloud metadata)
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 — private
    (a === 192 && b === 0 && c === 0) || // 192.0.0.0/24 — IETF protocol assignments
    (a === 192 && b === 168) || // 192.168.0.0/16 — private
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 — benchmarking
    a >= 224 // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved / broadcast
  );
}

/** Parse an IPv6 address (`::` shorthand and a dotted IPv4 tail allowed) into 8 hextets. */
function parseIPv6(addr: string): number[] | null {
  let text = addr;
  const tail: number[] = [];
  const dotted = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (dotted?.[1]) {
    const [a, b, c, d] = dotted.slice(2).map(Number) as [number, number, number, number];
    if ([a, b, c, d].some((o) => o > 255)) return null;
    tail.push((a << 8) | b, (c << 8) | d);
    // Keep a trailing "::"; otherwise drop the ":" that separates the IPv4 part.
    text = dotted[1].endsWith("::") ? dotted[1] : dotted[1].slice(0, -1);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const hextets = (s: string | undefined) => (s ? s.split(":") : []);
  const head = hextets(halves[0]);
  const rest = hextets(halves[1]);
  if ([...head, ...rest].some((h) => !/^[0-9a-f]{1,4}$/.test(h))) return null;
  const known = head.length + rest.length + tail.length;
  if (halves.length === 1 ? known !== 8 : known > 7) return null;
  const zeros = new Array<string>(8 - known).fill("0");
  return [...head, ...zeros, ...rest].map((h) => Number.parseInt(h, 16)).concat(tail);
}

/** The IPv4 address held by two hextets, dotted. */
function hextetsToIPv4(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/**
 * Returns true unless the IPv6 address (with or without zone ID / brackets) is public.
 * Only global unicast (2000::/3) can be; the forms that carry an IPv4 address
 * (IPv4-mapped, IPv4-translated, NAT64 64:ff9b::/96, 6to4) are judged by that address.
 * Anything that does not parse counts as private.
 */
export function isPrivateIPv6(ip: string): boolean {
  const addr = (ip.split("%")[0] ?? ip).replace(/^\[|\]$/g, "").toLowerCase();
  const h = parseIPv6(addr);
  if (!h) return true;
  const [h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0, h6 = 0, h7 = 0] = h;
  const lastIPv4IsPrivate = () => isPrivateIPv4(hextetsToIPv4(h6, h7));
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0) {
    // ::ffff:a.b.c.d IPv4-mapped and ::ffff:0:a.b.c.d IPv4-translated.
    if ((h4 === 0 && h5 === 0xffff) || (h4 === 0xffff && h5 === 0)) return lastIPv4IsPrivate();
    // The rest of ::/64: unspecified, loopback, deprecated IPv4-compatible ::a.b.c.d.
    return true;
  }
  // 64:ff9b::/96, the well-known NAT64 prefix.
  if (h0 === 0x64 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
    return lastIPv4IsPrivate();
  }
  // Outside 2000::/3 nothing is public: 64:ff9b:1::/48 local-use NAT64, 100::/64 discard,
  // fc00::/7 unique-local, fe80::/10 link-local, fec0::/10 site-local, ff00::/8 multicast.
  if ((h0 & 0xe000) !== 0x2000) return true;
  // 2001::/32 Teredo tunnels to an IPv4 address of its own.
  if (h0 === 0x2001 && h1 === 0) return true;
  // 2002::/16 6to4 embeds an IPv4 address in bits 16-47.
  if (h0 === 0x2002) return isPrivateIPv4(hextetsToIPv4(h1, h2));
  return false;
}

function privateUrlsAllowed(): boolean {
  return process.env.WEBFROST_ALLOW_PRIVATE_URLS === "true";
}

interface CheckedAddress {
  address: string;
  family: 4 | 6;
}

/**
 * Resolve `hostname` and throw if any address is private/loopback. Returns the checked
 * addresses (empty when WEBFROST_ALLOW_PRIVATE_URLS skips the check).
 */
async function resolvePublicHost(hostname: string): Promise<CheckedAddress[]> {
  if (privateUrlsAllowed()) return [];

  // URL.hostname keeps the brackets around IPv6 literals; DNS lookups do not accept them.
  const host = hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new Error("SSRF blocked: empty hostname");

  const results = await Bun.dns.lookup(host, { family: 0 });
  if (results.length === 0) throw new Error(`SSRF blocked: ${hostname} did not resolve`);
  const checked: CheckedAddress[] = [];
  for (const { address, family } of results) {
    if (family === 4 && isPrivateIPv4(address)) {
      throw new Error(`SSRF blocked: ${hostname} resolves to private IPv4 ${address}`);
    }
    if (family === 6 && isPrivateIPv6(address)) {
      throw new Error(`SSRF blocked: ${hostname} resolves to private IPv6 ${address}`);
    }
    if (family === 4 || family === 6) checked.push({ address, family });
  }
  return checked;
}

/** Throws if `hostname` resolves to any private/loopback address. */
export async function assertPublicHost(hostname: string): Promise<void> {
  await resolvePublicHost(hostname);
}

/** Parse `url`, require http(s) and a public host; returns the URL and the checked addresses. */
async function checkPublicUrl(url: string): Promise<{ parsed: URL; addresses: CheckedAddress[] }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`SSRF blocked: unsupported protocol ${parsed.protocol}`);
  }
  return { parsed, addresses: await resolvePublicHost(parsed.hostname) };
}

/**
 * Throws unless `url` is an http(s) URL whose host resolves only to public addresses.
 * Used for every hop of `safeFetch` and for every request the headless browser makes.
 */
export async function assertPublicUrl(url: string): Promise<void> {
  await checkPublicUrl(url);
}

/** One way to send a request: the URL to connect to and the init options that go with it. */
interface FetchTarget {
  url: string;
  init: Record<string, unknown>;
}

/**
 * The requests that reach `parsed` through one of the checked addresses, in order. The
 * connection goes to the address itself, so a second DNS answer (rebinding) is never
 * used; the Host header and the TLS server name (SNI and certificate check) stay the
 * hostname's. An IP literal, or no checked address (opt-out), is fetched as is.
 */
function fetchTargets(parsed: URL, addresses: CheckedAddress[]): FetchTarget[] {
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (addresses.length === 0 || isIP(hostname)) return [{ url: parsed.href, init: {} }];
  return addresses.map(({ address, family }) => {
    const pinned = new URL(parsed.href);
    pinned.hostname = family === 6 ? `[${address}]` : address;
    const init: Record<string, unknown> = { headers: { host: parsed.host } };
    if (parsed.protocol === "https:") init.tls = { serverName: hostname };
    return { url: pinned.href, init };
  });
}

/** Statuses that redirect when they carry a Location header; any other 3xx is final. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** One HTTP response received while following a request: a redirect hop or the final answer. */
export interface FetchedResponse {
  /** The URL this response answered. */
  url: string;
  status: number;
  statusText: string;
  headers: Headers;
  /**
   * The body as received. With `decompress: false` this is the payload still in its
   * `Content-Encoding` (gzip, br, ...), i.e. the exact bytes the server sent minus any
   * chunked transfer framing; otherwise it is the decoded body.
   */
  body: Uint8Array<ArrayBuffer>;
}

export interface GuardedFetchResult extends FetchedResponse {
  /** The URL that was asked for (before redirects). */
  requestedUrl: string;
  /** Redirect responses that were followed, in order, before the final one. */
  redirects: FetchedResponse[];
}

export interface SafeFetchOptions {
  /** Cancels the request (including redirects and the body download). */
  signal?: AbortSignal;
  /**
   * Leave the body in its Content-Encoding instead of letting the runtime decode it
   * (default true = decode). The WARC writer uses false to keep the bytes as sent.
   */
  decompress?: boolean;
  /**
   * Largest final response body to accept, in bytes (default 50 MB). A larger
   * Content-Length is refused before the body is read, and the download stops as soon as
   * the cap is passed; both throw `ResponseTooLargeError`.
   */
  maxBytes?: number;
}

/** The response body is over the size the caller allowed. */
export class ResponseTooLargeError extends Error {
  constructor(
    readonly maxBytes: number,
    message = `Response too large: exceeded ${maxBytes} bytes`,
  ) {
    super(message);
    this.name = "ResponseTooLargeError";
  }
}

/**
 * Make an error from a request to a pinned address read as one about the original host:
 * the address (and URL) it was sent to is swapped back for the hostname the caller asked for.
 */
function nameOriginalHost(err: unknown, parsed: URL, pinned: URL): void {
  if (!(err instanceof Error) || pinned.href === parsed.href) return;
  const bare = (h: string) => h.replace(/^\[|\]$/g, "");
  const swap = (text: string) =>
    text
      .split(pinned.href)
      .join(parsed.href)
      .split(pinned.host)
      .join(parsed.host)
      .split(bare(pinned.hostname))
      .join(bare(parsed.hostname));
  try {
    err.message = swap(err.message);
    if (err.stack) err.stack = swap(err.stack);
  } catch {
    // A read-only message stays as it is.
  }
}

/** Read a body stream into one buffer, failing once it exceeds `maxBytes`. */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          throw new ResponseTooLargeError(maxBytes);
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * Fetch `url` with SSRF protection and return every response along the way:
 * - only http(s), resolves hostname and rejects private/loopback IPs
 * - connects to the checked address itself, so DNS rebinding cannot redirect it
 * - follows 301/302/303/307/308 with a Location manually, re-validating each hop;
 *   any other 3xx is returned as the final response
 * - caps the response body at `options.maxBytes` (default 50 MB) to prevent OOM
 * - aborts after WEBFROST_FETCH_TIMEOUT_MS (default 30 s, whole request incl. redirects)
 *   or when `options.signal` aborts
 */
export async function fetchGuarded(
  url: string,
  options: SafeFetchOptions = {},
): Promise<GuardedFetchResult> {
  let currentUrl = url;
  const timeoutMs = envInt("WEBFROST_FETCH_TIMEOUT_MS", DEFAULT_FETCH_TIMEOUT_MS);
  const timeoutSignal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
  const signals = [timeoutSignal, options.signal].filter((s): s is AbortSignal => !!s);
  const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
  const redirects: FetchedResponse[] = [];

  const failure = (err: unknown): unknown => {
    if (options.signal?.aborted) return options.signal.reason ?? err;
    if (timeoutSignal?.aborted)
      return new Error(`Fetch timed out after ${timeoutMs}ms: ${currentUrl}`);
    return err;
  };

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    options.signal?.throwIfAborted();
    const { parsed, addresses } = await checkPublicUrl(currentUrl);

    // Try each checked address in turn, as a resolver-driven client would.
    let response: Response | undefined;
    let lastError: unknown;
    for (const target of fetchTargets(parsed, addresses)) {
      try {
        response = await fetch(target.url, {
          ...target.init,
          redirect: "manual",
          ...(signal ? { signal } : {}),
          ...(options.decompress === false ? { decompress: false } : {}),
        } as RequestInit);
        break;
      } catch (err) {
        nameOriginalHost(err, parsed, new URL(target.url));
        if (signal?.aborted) throw failure(err);
        lastError = err;
      }
    }
    if (!response) throw failure(lastError);

    const location = response.headers.get("location");
    if (REDIRECT_STATUSES.has(response.status) && location) {
      let body: Uint8Array<ArrayBuffer>;
      try {
        body = await readCapped(response, MAX_REDIRECT_BODY_BYTES);
      } catch (err) {
        // A redirect's body is informational only; an oversized one is not kept.
        if (signal?.aborted) throw failure(err);
        body = new Uint8Array(0);
      }
      redirects.push({
        url: currentUrl,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body,
      });
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }

    // Content-Length pre-check
    const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && Number(contentLength) > maxBytes) {
      await response.body?.cancel().catch(() => {});
      throw new ResponseTooLargeError(
        maxBytes,
        `Response too large: content-length=${contentLength}, max=${maxBytes}`,
      );
    }

    let body: Uint8Array<ArrayBuffer>;
    try {
      body = await readCapped(response, maxBytes);
    } catch (err) {
      throw failure(err);
    }

    return {
      url: currentUrl,
      requestedUrl: url,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      body,
      redirects,
    };
  }

  throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
}

/**
 * Fetch `url` with SSRF protection (see `fetchGuarded`).
 *
 * Returns a synthetic `Response` whose body has already been fully buffered.
 */
export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<Response> {
  const result = await fetchGuarded(url, options);
  // A Response with a null-body status (204, 205, 304) must not be given a body.
  const nullBody = [204, 205, 304].includes(result.status);
  return new Response(nullBody ? null : result.body, {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  });
}
