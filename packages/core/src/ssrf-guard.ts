/**
 * SSRF guard — validates URLs before fetching to prevent Server-Side Request Forgery.
 *
 * Resolves each hostname via DNS and rejects private/loopback IPs on every request
 * hop. Set WEBFROST_ALLOW_PRIVATE_URLS=true to opt out (e.g. for intranet archiving).
 *
 * Residual risk: the check resolves the hostname and the HTTP client resolves it
 * again, so a DNS-rebinding attacker with a very short TTL can still slip through.
 * Deployments that archive untrusted URLs should also block private ranges at the
 * network layer (see apps/docs/content/docs/architecture/security.mdx).
 */

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

/** Convert the last two hextets of an IPv6 address ("7f00:1") to dotted IPv4. */
function hextetsToIPv4(hi: string, lo: string): string | null {
  const h = Number.parseInt(hi, 16);
  const l = Number.parseInt(lo, 16);
  if (Number.isNaN(h) || Number.isNaN(l) || h > 0xffff || l > 0xffff) return null;
  return `${h >> 8}.${h & 0xff}.${l >> 8}.${l & 0xff}`;
}

/** Returns true if the IPv6 address (with or without zone ID / brackets) is private/loopback. */
export function isPrivateIPv6(ip: string): boolean {
  const addr = (ip.split("%")[0] ?? ip).replace(/^\[|\]$/g, "").toLowerCase();
  if (addr === "::1" || addr === "0:0:0:0:0:0:0:1") return true; // loopback
  if (addr === "::" || addr === "0:0:0:0:0:0:0:0") return true; // unspecified
  // fc00::/7 unique-local (fc and fd prefixes)
  if (/^f[cd]/.test(addr)) return true;
  // fe80::/10 link-local and fec0::/10 deprecated site-local
  if (/^fe[89a-f]/.test(addr)) return true;
  // ff00::/8 multicast
  if (addr.startsWith("ff")) return true;
  // ::ffff:x.x.x.x IPv4-mapped (dotted form) — check the embedded IPv4 part
  const v4mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (v4mapped?.[1]) return isPrivateIPv4(v4mapped[1]);
  // ::ffff:7f00:1 IPv4-mapped (hex form, as normalised by the URL parser)
  const v4mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(addr);
  if (v4mappedHex?.[1] && v4mappedHex[2]) {
    const v4 = hextetsToIPv4(v4mappedHex[1], v4mappedHex[2]);
    return v4 === null || isPrivateIPv4(v4);
  }
  // 64:ff9b::/96 NAT64 — embeds an IPv4 address in the last 32 bits
  const nat64 = /^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(addr);
  if (nat64?.[1] && nat64[2]) {
    const v4 = hextetsToIPv4(nat64[1], nat64[2]);
    return v4 === null || isPrivateIPv4(v4);
  }
  return false;
}

function privateUrlsAllowed(): boolean {
  return process.env.WEBFROST_ALLOW_PRIVATE_URLS === "true";
}

/** Throws if `hostname` resolves to any private/loopback address. */
export async function assertPublicHost(hostname: string): Promise<void> {
  if (privateUrlsAllowed()) return;

  // URL.hostname keeps the brackets around IPv6 literals; DNS lookups do not accept them.
  const host = hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new Error("SSRF blocked: empty hostname");

  const results = await Bun.dns.lookup(host, { family: 0 });
  if (results.length === 0) throw new Error(`SSRF blocked: ${hostname} did not resolve`);
  for (const { address, family } of results) {
    if (family === 4 && isPrivateIPv4(address)) {
      throw new Error(`SSRF blocked: ${hostname} resolves to private IPv4 ${address}`);
    }
    if (family === 6 && isPrivateIPv6(address)) {
      throw new Error(`SSRF blocked: ${hostname} resolves to private IPv6 ${address}`);
    }
  }
}

/**
 * Throws unless `url` is an http(s) URL whose host resolves only to public addresses.
 * Used for every hop of `safeFetch` and for every request the headless browser makes.
 */
export async function assertPublicUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`SSRF blocked: unsupported protocol ${parsed.protocol}`);
  }
  await assertPublicHost(parsed.hostname);
}

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
          throw new Error(`Response too large: exceeded ${maxBytes} bytes`);
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
 * - follows redirects manually, re-validating each hop
 * - caps the response body at 50 MB to prevent OOM
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
    await assertPublicUrl(currentUrl);

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        redirect: "manual",
        ...(signal ? { signal } : {}),
        ...(options.decompress === false ? { decompress: false } : {}),
      } as RequestInit);
    } catch (err) {
      throw failure(err);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect missing Location header");
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
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && Number(contentLength) > MAX_RESPONSE_BYTES) {
      throw new Error(
        `Response too large: content-length=${contentLength}, max=${MAX_RESPONSE_BYTES}`,
      );
    }

    let body: Uint8Array<ArrayBuffer>;
    try {
      body = await readCapped(response, MAX_RESPONSE_BYTES);
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
