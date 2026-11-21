/** Codes the server puts in the `code` field of its `{ error, code }` error bodies. */
export type ApiErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION"
  | "INVALID_JSON"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CROSS_ORIGIN_REQUEST"
  | "SETUP_TOKEN_INVALID"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "RATE_LIMITED"
  | "INTERNAL";

/**
 * Codes the client itself raises when there is no HTTP response to read (`status` is 0), or the
 * response was not what the API promises.
 */
export type ClientErrorCode = "NETWORK_ERROR" | "TIMEOUT" | "ABORTED" | "INVALID_RESPONSE";

/** Every code a {@link WebFrostError} can carry. Newer servers may send codes this list lacks. */
export type WebFrostErrorCode = ApiErrorCode | ClientErrorCode;

/** The code an error would carry if the server had not sent one (mirrors the server's mapping). */
function codeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 413:
      return "PAYLOAD_TOO_LARGE";
    case 415:
      return "UNSUPPORTED_MEDIA_TYPE";
    case 429:
      return "RATE_LIMITED";
    default:
      return status >= 500 ? "INTERNAL" : "BAD_REQUEST";
  }
}

/** Every failure of a client call: an HTTP error, a network failure, a timeout or an abort. */
export class WebFrostError extends Error {
  /** HTTP status, or 0 when there was no response (network error, timeout, abort). */
  public readonly status: number;
  /**
   * Machine-readable code: the server's `code` for HTTP errors, a status-derived one when the
   * server sent none, or NETWORK_ERROR / TIMEOUT / ABORTED / INVALID_RESPONSE from the client.
   * Branch on this rather than on `message`.
   */
  public readonly code: WebFrostErrorCode | (string & Record<never, never>);
  /** Seconds to wait before retrying, parsed from the `Retry-After` header (typically on 429). */
  public readonly retryAfter?: number;

  constructor(
    status: number,
    message: string,
    retryAfter?: number,
    code?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "WebFrostError";
    this.status = status;
    this.code = code ?? (status > 0 ? codeForStatus(status) : "NETWORK_ERROR");
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

/** Parse a `Retry-After` header given as delta-seconds (or an HTTP date). */
export function parseRetryAfter(res: Response): number | undefined {
  const value = res.headers?.get("Retry-After");
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

/**
 * Turn a non-2xx response into a {@link WebFrostError}, surfacing the server's `{ error, code }`
 * body. Falls back to the status text when the body is not that shape.
 */
export async function parseError(res: Response): Promise<WebFrostError> {
  let message = res.statusText || `HTTP ${res.status}`;
  let code: string | undefined;
  try {
    const text = await res.text();
    if (text) {
      const body: unknown = JSON.parse(text);
      if (body && typeof body === "object") {
        const { error, code: bodyCode } = body as { error?: unknown; code?: unknown };
        if (typeof error === "string" && error) message = error;
        if (typeof bodyCode === "string" && bodyCode) code = bodyCode;
      }
    }
  } catch {
    // Not JSON (a proxy's HTML page, an empty body): keep the status text.
  }
  return new WebFrostError(res.status, message, parseRetryAfter(res), code);
}
