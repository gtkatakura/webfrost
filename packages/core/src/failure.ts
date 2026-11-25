/**
 * Why a snapshot could not be archived, as a stable category the archive stores, the API returns and the
 * web UI groups by, plus the class that says what to do about it:
 *
 * - `permanent`: the page or the site is gone, or never could be archived from here (no retry helps).
 * - `transient`: the site or the network was unwell at that moment; a later retry may well work.
 * - `blocked`:   the site answered, but refused this client (anti-bot, login, a refused request).
 * - `internal`:  WebFrost itself did not finish the run (crash, restart, nothing produced).
 */
export type FailureClass = "permanent" | "transient" | "blocked" | "internal";

export const FAILURE_CATEGORIES = {
  domain_not_found: { class: "permanent", label: "Domain does not exist" },
  page_not_found: { class: "permanent", label: "Page not found (404/410)" },
  private_address: { class: "permanent", label: "Resolves to a private address" },
  tls_error: { class: "permanent", label: "TLS or certificate error" },
  redirect_loop: { class: "permanent", label: "Too many redirects" },
  bad_request: { class: "permanent", label: "Request rejected (400)" },
  unsupported_url: { class: "permanent", label: "Not a web address (http or https)" },
  access_denied: { class: "blocked", label: "Access denied (401/403)" },
  refused_client: { class: "blocked", label: "Client refused (other 4xx)" },
  rate_limited: { class: "transient", label: "Rate limited (429)" },
  server_error: { class: "transient", label: "Server error (5xx)" },
  timeout: { class: "transient", label: "Timed out" },
  network_error: { class: "transient", label: "Network error" },
  dns_error: { class: "transient", label: "DNS lookup failed" },
  interrupted: { class: "internal", label: "Interrupted" },
  no_output: { class: "internal", label: "Nothing could be archived" },
  error: { class: "internal", label: "Unexpected error" },
} as const satisfies Record<string, { class: FailureClass; label: string }>;

export type FailureCategory = keyof typeof FAILURE_CATEGORIES;

export interface Failure {
  category: FailureCategory;
  /** The message as it came from the fetch, the browser or the job runner, for the details view. */
  detail: string;
}

export function failureClass(category: FailureCategory): FailureClass {
  return FAILURE_CATEGORIES[category].class;
}

export function isFailureCategory(value: string): value is FailureCategory {
  return Object.hasOwn(FAILURE_CATEGORIES, value);
}

/** The category of an HTTP status the page answered with (only for statuses that end the run). */
export function categorizeStatus(status: number | null | undefined): FailureCategory {
  if (!status) return "error";
  if (status === 404 || status === 410) return "page_not_found";
  if (status === 401 || status === 403) return "access_denied";
  if (status === 429) return "rate_limited";
  if (status === 400) return "bad_request";
  // Cloudflare's 52x are origin failures, LinkedIn's 999 is its anti-bot answer.
  if (status >= 500 && status <= 599) return "server_error";
  if (status === 999 || (status >= 400 && status <= 499)) return "refused_client";
  return "error";
}

/**
 * The message without the parts a remote site chooses: URLs, and the hostname the address guard
 * names. A redirect to `http://nxdomain.example/timeout` must not decide the category.
 */
function withoutRemoteText(message: string): string {
  return message
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, " ")
    .replace(/^(ssrf blocked: )\S+ (resolves to|did not resolve)/i, "$1<host> $2");
}

/** The category of an error the page fetch threw (DNS, socket, TLS, timeout, guard). */
export function categorizeError(message: string): FailureCategory {
  const m = withoutRemoteText(message).toLowerCase();
  // The guard's and the fetch's own messages first: they say exactly what happened.
  if (m.startsWith("ssrf blocked:")) {
    if (/unsupported protocol|empty hostname/.test(m)) return "unsupported_url";
    if (m.includes("did not resolve")) return "dns_error";
    if (m.includes("resolves to private")) return "private_address";
  }
  if (m.startsWith("fetch timed out")) return "timeout";
  // getaddrinfo ENOTFOUND / NXDOMAIN: the name does not exist. ESERVFAIL and EAI_AGAIN are the resolver's
  // trouble, and ETIMEOUT the lookup's; those can pass.
  if (/\benotfound\b|\bnxdomain\b/.test(m)) return "domain_not_found";
  if (/eservfail|eai_again|getaddrinfo etimeout|enodata/.test(m)) return "dns_error";
  if (/private ip|non-public|private address/.test(m)) return "private_address";
  if (m.includes("too many redirects")) return "redirect_loop";
  if (/timed out|timeout/.test(m)) return "timeout";
  if (/cert|tls|ssl|eproto|handshake/.test(m)) return "tls_error";
  if (/econnreset|econnrefused|enetunreach|ehostunreach|epipe|socket|network|connection/.test(m))
    return "network_error";
  return "error";
}

export function failureFromStatus(status: number | null | undefined, url: string): Failure {
  return {
    category: categorizeStatus(status),
    detail: `HTTP ${status ?? "no status"} from ${url}`,
  };
}

export function failureFromError(message: string): Failure {
  return { category: categorizeError(message), detail: message };
}
