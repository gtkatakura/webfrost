// Checks that run on every state-changing API request before its body is parsed:
// cross-origin (CSRF) protection and the accepted request content types.
import { Elysia } from "elysia";
import { type ApiErrorCode, jsonError } from "../errors";
import { importBundleMaxBytes, importMaxBytes, maxRequestBodyBytes } from "../limits";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The one route that takes a multipart upload instead of JSON. */
const MULTIPART_ROUTE = /^\/api(?:\/v1)?\/import\/file\/?$/;

/** The one route that takes a ZIP body: a snapshot bundle, streamed to disk. */
const BUNDLE_ROUTE = /^\/api(?:\/v1)?\/snapshots\/import\/?$/;

/** Slack over the import limit for multipart framing and the other form fields. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/**
 * True when a state-changing request plausibly came from this app's own pages.
 *
 * Browsers mark every request with Sec-Fetch-Site; only `same-origin` (the UI's own
 * fetch) and `none` (typed by the user) are accepted — `same-site` is rejected too,
 * since a sibling subdomain must not be able to act with the admin's session cookie
 * (SameSite=Strict does not stop it). Browsers without Fetch Metadata still send
 * Origin on POST, which must then name this host. A request with neither header
 * did not come from a browser and cannot ride on an ambient cookie.
 */
export function isSameOriginRequest(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin" || site === "none";

  const origin = request.headers.get("origin");
  if (origin === null) return true;
  const host = request.headers.get("host") ?? new URL(request.url).host;
  return hostOf(origin) === host;
}

function mediaType(request: Request): string | null {
  const header = request.headers.get("content-type");
  if (header === null) return null;
  return header.split(";")[0]?.trim().toLowerCase() ?? "";
}

function hasBody(request: Request): boolean {
  const length = request.headers.get("content-length");
  if (length !== null) return Number(length) > 0;
  return request.headers.has("transfer-encoding");
}

/** Why the request is refused, or null when it may proceed. */
export function checkApiRequest(
  request: Request,
): { status: number; code: ApiErrorCode; error: string } | null {
  if (SAFE_METHODS.has(request.method)) return null;
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith("/api/")) return null;

  // Forms cannot set an Authorization header, so Bearer requests need no CSRF check.
  const bearer = request.headers.get("authorization")?.startsWith("Bearer ") === true;
  if (!bearer && !isSameOriginRequest(request)) {
    return { status: 403, code: "CROSS_ORIGIN_REQUEST", error: "cross-origin request rejected" };
  }

  const type = mediaType(request);
  const declaredLength = request.headers.get("content-length");
  if (BUNDLE_ROUTE.test(pathname)) {
    if (type !== "application/zip") {
      return {
        status: 415,
        code: "UNSUPPORTED_MEDIA_TYPE",
        error: "content type must be application/zip",
      };
    }
    // Chunked uploads are fine here: the route counts the bytes as it streams them to disk.
    if (Number(declaredLength ?? "0") > importBundleMaxBytes()) {
      return { status: 413, code: "PAYLOAD_TOO_LARGE", error: "bundle too large" };
    }
    return null;
  }

  // The listener accepts bodies as large as a bundle; every other route keeps the usual
  // limit, checked here before anything reads the body. A chunked body has no length to
  // check up front, so outside the bundle import it must declare one.
  if (declaredLength === null && request.headers.has("transfer-encoding")) {
    return { status: 411, code: "BAD_REQUEST", error: "request body needs a Content-Length" };
  }

  if (MULTIPART_ROUTE.test(pathname)) {
    if (type !== "multipart/form-data") {
      return {
        status: 415,
        code: "UNSUPPORTED_MEDIA_TYPE",
        error: "content type must be multipart/form-data",
      };
    }
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > importMaxBytes() + MULTIPART_OVERHEAD_BYTES) {
      return { status: 413, code: "PAYLOAD_TOO_LARGE", error: "import file too large" };
    }
    return null;
  }

  if (Number(declaredLength ?? "0") > maxRequestBodyBytes()) {
    return { status: 413, code: "PAYLOAD_TOO_LARGE", error: "request body too large" };
  }

  // Everything else takes JSON (or no body at all, e.g. DELETE and logout).
  if (type === null ? hasBody(request) : type !== "application/json") {
    return {
      status: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
      error: "content type must be application/json",
    };
  }
  return null;
}

/**
 * Runs before routing and body parsing, so a cross-site form post is refused before
 * Elysia turns its url-encoded body into an object a route would accept.
 */
export const requestGuardPlugin = new Elysia({ name: "request-guard" }).onRequest(
  async ({ request }) => {
    const refusal = checkApiRequest(request);
    if (refusal) return jsonError(refusal.status, refusal.code, refusal.error);
    return;
  },
);
