import { WebFrostError } from "@webfrost/sdk";

export function isStatus(err: unknown, status: number): err is WebFrostError {
  return err instanceof WebFrostError && err.status === status;
}

function rateLimitMessage(err: WebFrostError, what: string): string {
  return err.retryAfter !== undefined
    ? `${what} Try again in ${err.retryAfter} second${err.retryAfter === 1 ? "" : "s"}.`
    : `${what} Please try again later.`;
}

function commonMessage(err: unknown, fallback: string): string {
  if (err instanceof WebFrostError) {
    if (err.status >= 500) return "Server error. Please try again in a moment.";
    return err.message ? `${fallback} (${err.message})` : fallback;
  }
  return "Cannot reach the server. Check your connection and try again.";
}

/** Human-readable message for a failed login attempt. */
export function loginErrorMessage(err: unknown): string {
  if (isStatus(err, 401)) return "Invalid username or password.";
  if (isStatus(err, 429)) return rateLimitMessage(err, "Too many attempts.");
  return commonMessage(err, "Sign in failed.");
}

/** Human-readable message for a failed first-run setup. */
export function setupErrorMessage(err: unknown): string {
  if (isStatus(err, 409)) return "Setup has already been completed. Please sign in instead.";
  if (isStatus(err, 403)) return "The setup token is incorrect.";
  if (isStatus(err, 429)) return rateLimitMessage(err, "Too many attempts.");
  return commonMessage(err, "Setup failed.");
}

/** Human-readable message for any thrown value, for toasts and inline errors. */
export function errorMessage(err: unknown): string {
  if (err instanceof WebFrostError) return err.message || `Request failed (${err.status})`;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Retry policy for queries: never retry auth/not-found/rate-limit errors. */
export function shouldRetry(failureCount: number, err: unknown): boolean {
  if (err instanceof WebFrostError && [401, 403, 404, 429].includes(err.status)) return false;
  return failureCount < 1;
}
