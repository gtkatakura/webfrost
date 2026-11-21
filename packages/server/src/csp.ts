import { getStorage } from "./context";

// Presigned-URL origin per storage configuration, so the probe signature is computed once.
const storageOrigins = new Map<string, string | null>();

/**
 * Origin that archive downloads redirect to, or null when files are served by
 * this server. With the S3 backend, `/download` answers 302 to a presigned URL
 * on the bucket's host; the browser then loads screenshots and media from there,
 * so that origin has to be allowed by the image and media directives.
 */
function storageOrigin(): string | null {
  if (process.env.WEBFROST_STORAGE_BACKEND !== "s3") return null;
  const prefix = process.env.S3_PATH_PREFIX ?? "snapshots";
  const cacheKey = [process.env.S3_ENDPOINT, process.env.S3_BUCKET, prefix].join("|");
  const cached = storageOrigins.get(cacheKey);
  if (cached !== undefined) return cached;

  let origin: string | null = null;
  try {
    const url = getStorage().presignedDownloadUrl(`s3:${prefix}/0/probe`);
    origin = url ? new URL(url).origin : null;
  } catch {
    // Storage misconfigured — requests that touch it will report the real error.
  }
  storageOrigins.set(cacheKey, origin);
  return origin;
}

/**
 * Content-Security-Policy for the app shell and the API.
 *
 * - Scripts only from this origin; no inline script, no eval.
 * - `frame-src 'self'` exists for one thing: the sandboxed archive preview iframe.
 * - `media-src` lets the Media tab play archived audio/video.
 * - Nothing may frame the app (`frame-ancestors 'none'`).
 */
export function appContentSecurityPolicy(): string {
  const storage = storageOrigin();
  const files = storage ? ` ${storage}` : "";
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data:${files}`,
    `media-src 'self'${files}`,
    "connect-src 'self'",
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
