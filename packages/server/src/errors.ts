import type { ErrorHandler } from "elysia";
import { logger } from "./logger";

/**
 * Machine-readable error codes. Every JSON error the API returns has the shape
 * `{ error, code }`: `error` is the human-readable message (kept stable for existing
 * clients), `code` is what clients should branch on.
 */
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

/** Code for an error body that a route returned without one. */
export function codeForStatus(status: number): ApiErrorCode {
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

/** Add a `code` to a route's `{ error }` body; anything else is returned unchanged. */
export function withErrorCode(response: unknown, status: number): unknown {
  if (
    response &&
    typeof response === "object" &&
    !(response instanceof Response) &&
    typeof (response as { error?: unknown }).error === "string" &&
    !("code" in response)
  ) {
    return { ...response, code: codeForStatus(status) };
  }
  return response;
}

/** JSON error response with a status, for code that has no Elysia context. */
export function jsonError(status: number, code: ApiErrorCode, error: string): Response {
  return Response.json({ error, code }, { status });
}

export const SETUP_VALIDATION_MESSAGE =
  "username is required and password must be at least 8 characters";

/**
 * The message a validation failure reports. Kept per route because clients already
 * show these strings (POST /snapshots → "invalid url", setup → its own hint).
 */
function validationMessage(method: string, pathname: string): string {
  if (/^(?:\/api)?\/setup\/?$/.test(pathname)) return SETUP_VALIDATION_MESSAGE;
  if (method === "POST" && /^(?:\/api)?\/snapshots\/?$/.test(pathname)) return "invalid url";
  return "invalid request";
}

/**
 * The one error handler for the API: framework errors (unknown route, malformed
 * JSON, failed validation) and anything a route throws become `{ error, code }`
 * JSON instead of Elysia's plain-text or verbose defaults. Mounted globally by the
 * app, and by each router so it behaves the same when mounted on its own (tests).
 */
export const apiErrorHandler: ErrorHandler = ({ code, error, request, set }) => {
  const reply = (status: number, errorCode: ApiErrorCode, message: string) => {
    set.status = status;
    set.headers["content-type"] = "application/json";
    return { error: message, code: errorCode };
  };
  switch (code) {
    case "NOT_FOUND":
      return reply(404, "NOT_FOUND", "not found");
    case "PARSE":
      return reply(400, "INVALID_JSON", "malformed request body");
    case "VALIDATION":
    case "INVALID_FILE_TYPE":
      return reply(
        400,
        "VALIDATION",
        validationMessage(request.method, new URL(request.url).pathname),
      );
    case "INVALID_COOKIE_SIGNATURE":
      return reply(400, "BAD_REQUEST", "invalid cookie");
    default: {
      // Errors raised with an explicit status (Elysia's `status()` helper) keep it.
      const status =
        error && typeof error === "object" && "status" in error && typeof error.status === "number"
          ? error.status
          : 500;
      if (status >= 500) {
        logger.error({ err: error, path: new URL(request.url).pathname }, "unhandled error");
        return reply(status, "INTERNAL", "internal server error");
      }
      return reply(status, codeForStatus(status), error instanceof Error ? error.message : "error");
    }
  }
};
