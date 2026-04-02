/**
 * SSRF guard — validates URLs before fetching to prevent Server-Side Request Forgery.
 *
 * Resolves each hostname via DNS and rejects private/loopback IPs on every request
 * hop. Set WEBFROST_ALLOW_PRIVATE_URLS=true to opt out (e.g. for intranet archiving).
 */

const MAX_RESPONSE_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_REDIRECTS = 5;

/** Returns true if the dotted-decimal IPv4 address falls in a private/reserved range. */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  // length is 4 so indices 0 and 1 are always defined
  // biome-ignore lint/style/noNonNullAssertion: guarded by length check above
  const a = parts[0]!;
  // biome-ignore lint/style/noNonNullAssertion: guarded by length check above
  const b = parts[1]!;
  return (
    a === 0 || // 0.0.0.0/8 — "this" network
    a === 10 || // 10.0.0.0/8 — private
    a === 127 || // 127.0.0.0/8 — loopback
    (a === 169 && b === 254) || // 169.254.0.0/16 — link-local (AWS metadata)
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 — private
    (a === 192 && b === 168) || // 192.168.0.0/16 — private
    a >= 240 // 240.0.0.0/4 — reserved / broadcast
  );
}

/** Returns true if the IPv6 address (with or without zone ID) is private/loopback. */
export function isPrivateIPv6(ip: string): boolean {
  const addr = (ip.split("%")[0] ?? ip).toLowerCase();
  if (addr === "::1" || addr === "0:0:0:0:0:0:0:1") return true; // loopback
  if (addr === "::" || addr === "0:0:0:0:0:0:0:0") return true; // unspecified
  // fc00::/7 unique-local (fc and fd prefixes)
  if (/^f[cd]/i.test(addr)) return true;
  // fe80::/10 link-local
  if (/^fe[89ab]/i.test(addr)) return true;
  // ::ffff:x.x.x.x IPv4-mapped — check the embedded IPv4 part
  const v4mapped = /^::ffff:([\d.]+)$/.exec(addr);
  if (v4mapped?.[1]) return isPrivateIPv4(v4mapped[1]);
  return false;
}

/** Throws if `hostname` resolves to any private/loopback address. */
async function assertPublicHost(hostname: string): Promise<void> {
  if (process.env.WEBFROST_ALLOW_PRIVATE_URLS === "true") return;

  const results = await Bun.dns.lookup(hostname, { family: 0 });
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
 * Fetch `url` with SSRF protection:
 * - resolves hostname and rejects private/loopback IPs
 * - follows redirects manually, re-validating each hop
 * - caps the response body at 50 MB to prevent OOM
 *
 * Returns a synthetic `Response` whose body has already been fully buffered.
 */
export async function safeFetch(url: string): Promise<Response> {
  let currentUrl = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      throw new Error(`Invalid URL: ${currentUrl}`);
    }

    await assertPublicHost(parsed.hostname);

    const response = await fetch(currentUrl, { redirect: "manual" });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect missing Location header");
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

    // Stream with hard size cap
    const reader = response.body?.getReader();
    if (!reader) {
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new Error(`Response too large: exceeded ${MAX_RESPONSE_BYTES} bytes`);
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

    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
}
