// The Content-Security-Policy of one built page. The pages carry React Router's inline scripts (hydration
// data, streaming), different on every page. Rather than allowing any inline script, the policy lists the
// SHA-256 of exactly the ones the page has. Cloudflare Web Analytics adds its beacon script on the way out,
// so its host is allowed too. Styles stay 'unsafe-inline': React writes style attributes.
const inlineScript = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

export function contentSecurityPolicy(html: string): string {
  const hashes = new Set<string>();
  for (const [, body] of html.matchAll(inlineScript)) {
    if (!body) continue;
    hashes.add(`'sha256-${new Bun.CryptoHasher("sha256").update(body).digest("base64")}'`);
  }
  return [
    "default-src 'self'",
    ["script-src 'self'", ...hashes, "https://static.cloudflareinsights.com"].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self' https://cloudflareinsights.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
