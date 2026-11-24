/** Lifecycle of a snapshot: queued or running, finished, or gave up. */
export type SnapshotStatus = "pending" | "done" | "failed";

/** Import source formats the server understands. */
export type ImportFormat = "rss" | "opml" | "netscape" | "text";

/** Outcome of a schedule's most recent run (null before its first run). */
export type ScheduleRunStatus = "success" | "failed";

/** Which form of an archive result to address. */
export type ArchiveUrlKind = "download" | "preview";

/** Response from POST /snapshots (202 Accepted) */
export interface SnapshotCreated {
  id: number;
  url: string;
  status: "pending";
}

/** Response from POST /snapshots/import (201 Created): the new snapshot. */
export interface SnapshotImported {
  id: number;
  url: string;
  status: "done" | "failed";
  /** The failed snapshot this one replaced (now in the trash), when imported with `replaces`. */
  replaced?: number;
}

/** Options for {@link WebFrostClient.importSnapshot}. */
export interface ImportSnapshotOptions extends RequestOptions {
  /** Size of the bundle in bytes, for a stream (a Blob or Uint8Array knows its own). */
  contentLength?: number;
  /** Give up after this many milliseconds; default 0, no timeout (bundles can be large). */
  timeoutMs?: number;
  /**
   * A failed snapshot of the same URL that this (done) copy replaces: it moves to the trash in the same
   * step. `CONFLICT` (409) when it is not, or no longer, a failure of that URL; nothing is stored then.
   */
  replaces?: number;
}

/** Tag attached to a snapshot */
export interface Tag {
  id: number;
  name: string;
  slug: string;
  color: string | null;
  createdAt: string;
}

/**
 * One page of a list endpoint. Every list in the API uses this envelope: `page` is 1-based,
 * `limit` is the page size the server applied (at most 200), `total` counts every match.
 */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/** `page` and `limit` for any list method. */
export interface PageOptions {
  /** Page number (1-indexed). Defaults to 1. */
  page?: number;
  /** Items per page (1-200; the server caps larger values). Defaults to 20. */
  limit?: number;
}

/** Single snapshot from GET /snapshots list. Timestamps are ISO 8601 UTC ("2026-11-21T21:42:38Z"). */
/** What kind of failure a category is: what is worth doing about it. */
export type FailureClass = "permanent" | "transient" | "blocked" | "internal";

/** Why a failed snapshot could not be archived. */
export interface SnapshotFailure {
  /** Stable id, e.g. "domain_not_found", "page_not_found", "access_denied", "timeout". */
  category: string;
  class: FailureClass;
  /** For people, e.g. "Domain does not exist". */
  label: string;
  /** The message behind it; null for guests. */
  detail: string | null;
}

/** A group of failed snapshots that call for the same decision. */
export type FailureGroupId =
  | "domain-gone"
  | "page-gone"
  | "blocked"
  | "rate-limited"
  | "temporary"
  | "site-setup"
  | "private-address"
  | "interrupted"
  | "unknown";

export interface FailureGroupSummary {
  id: FailureGroupId;
  label: string;
  categories: string[];
  /** Failed snapshots in the group (not counting the trash). */
  count: number;
  /** Distinct domains among them. */
  domains: number;
}

/** A domain within a failure group. */
export interface FailureDomain {
  host: string;
  count: number;
  /** Of those, the pages that also have a snapshot that worked (never touched from the failure pages). */
  withWorkingSnapshot: number;
  lastFailedAt: string;
  example: { id: number; url: string };
}

export interface FailureDomainPage extends Page<FailureDomain> {
  /** Failed snapshots across every domain that matches (not only this page). */
  snapshots: number;
}

export interface FailedSnapshot {
  id: number;
  url: string;
  createdAt: string;
  failure: SnapshotFailure | null;
  /** The newest snapshot of the same URL that worked, if any. */
  workingSnapshotId: number | null;
}

/**
 * What a bulk decision on a failure group applies to: explicit `hosts` and/or `ids`, or `all` (every
 * failed snapshot of the group, narrowed by the page's filter `q` and, on a domain's page, `host`) less
 * what was unticked (`excludeHosts`, `excludeIds`). "Select all N" sends no ids.
 */
export interface FailureSelection {
  hosts?: string[];
  ids?: number[];
  all?: boolean;
  q?: string;
  host?: string;
  excludeHosts?: string[];
  excludeIds?: number[];
}

/** Explicit `ids`, or `all` (everything in the trash) less `excludeIds`. */
export interface TrashSelection {
  ids?: number[];
  all?: boolean;
  excludeIds?: number[];
}

export interface TrashedSnapshot {
  id: number;
  url: string;
  status: SnapshotStatus;
  failure: SnapshotFailure | null;
  createdAt: string;
  trashedAt: string;
  /** When it is deleted for good. */
  deleteAfter: string | null;
}

export interface TrashPage extends Page<TrashedSnapshot> {
  retentionDays: number;
}

export interface GeneralSettings {
  /** Days a snapshot stays in the trash before it is deleted for good. */
  trashRetentionDays: number;
  trashRetentionLimits: { min: number; max: number };
}

export interface Snapshot {
  id: number;
  url: string;
  status: SnapshotStatus;
  /** Why the snapshot failed; null unless status is "failed" (and for servers older than 0.3). */
  failure: SnapshotFailure | null;
  createdAt: string;
  /** Extractor names that have produced results for this snapshot (e.g. ["warc", "readability"]) */
  extractors: string[];
  /** Tags attached to this snapshot */
  tags: Tag[];
  /** Page title extracted via readability (null if unavailable) */
  title: string | null;
  /** Short excerpt from readability content (null if unavailable) */
  excerpt: string | null;
  /** URL of the screenshot (resolved against `baseUrl`), or null when there is none */
  screenshotUrl: string | null;
}

/** Archive result extracted by a single extractor */
export interface ArchiveResult {
  id: number;
  extractor: string;
  /**
   * The data itself for inline extractors (readability JSON, html); null for file-backed ones
   * (warc, pdf, screenshot, dom-snapshot, singlefile, media, media-metadata): fetch those from
   * `downloadUrl`.
   */
  content: string | null;
  /** URL that serves the result as a file (resolved against `baseUrl`). */
  downloadUrl: string;
  /** URL of the sandboxed HTML preview (dom-snapshot, singlefile), or null when there is none. */
  previewUrl: string | null;
  createdAt: string;
}

/** Per-extractor timing and file-size metadata from GET /snapshots/:id */
export interface ExtractorMeta {
  status: "success" | "failed";
  durationMs: number | null;
  fileSizeBytes: number | null;
  error?: string;
}

/** Full snapshot detail from GET /snapshots/:id */
export interface SnapshotDetail extends Snapshot {
  archiveResults: ArchiveResult[];
  /** Keyed by extractor name; only present for extractors that ran during the last pipeline execution */
  extractorMeta: Record<string, ExtractorMeta>;
}

export interface WebFrostClientOptions {
  /**
   * Where the server is: its origin, e.g. "http://localhost:3000", plus the path it is mounted
   * under when a reverse proxy serves it below one ("https://example.com/webfrost"). The client
   * adds `/api/v1` itself. Defaults to "" — the page's own origin, for code running in the
   * browser on the server's pages. A legacy value ending in `/api` (or `/api/v1`) still works:
   * the suffix is dropped, with a one-time console warning.
   */
  baseUrl?: string;
  /** API key for Bearer authentication. All requests will include Authorization: Bearer <apiKey>. */
  apiKey?: string;
  /**
   * Per-attempt timeout in milliseconds, covering the response headers and body.
   * Defaults to 30000. `0` disables it.
   */
  timeoutMs?: number;
  /**
   * Custom `fetch` (SSR, tests, proxies). Defaults to the global `fetch`, looked up on every
   * request.
   */
  fetch?: typeof fetch;
  /**
   * How many times to retry a failed idempotent request (GET/HEAD) on a network error, a timeout,
   * 429 or 502/503/504. Defaults to 0 (no retries). Writes are never retried.
   */
  retries?: number;
  /** Base delay for exponential backoff with jitter, in ms. Defaults to 250. */
  retryDelayMs?: number;
  /**
   * Longest the client will wait between attempts, in ms. Defaults to 30000. A `Retry-After`
   * longer than this is not waited out: the error is thrown instead.
   */
  maxRetryDelayMs?: number;
  /**
   * The `credentials` mode for requests. Defaults to "same-origin". Use "include" when the
   * browser page and the API are on different origins and you rely on the session cookie
   * (`login()`). Outside the browser, authenticate with an API key instead.
   */
  credentials?: RequestCredentials;
}

/** Options accepted by every request method. */
export interface RequestOptions {
  /** Abort the request. Combined with the client's timeout. */
  signal?: AbortSignal | undefined;
}

/**
 * Filters of the snapshot list and of the search. The server applies them to the whole archive,
 * so `total` and the pages count only what they keep.
 */
export interface SnapshotFilters {
  /** One status, or several: a snapshot in any of them is kept. */
  status?: SnapshotStatus | readonly SnapshotStatus[];
  /** Created at or after this moment: an ISO 8601 date or timestamp, or a Date. */
  since?: string | Date;
  /** Created before this moment: an ISO 8601 date or timestamp, or a Date. */
  before?: string | Date;
  /** Extractor names (`"pdf"`, `"warc"`, ...): kept when every one of them produced output. */
  extractors?: readonly string[];
  /** Tag ids: kept when the snapshot carries every one of them. */
  tags?: readonly number[];
  /** The URL or the title contains this text (the case of ASCII letters is ignored). */
  contains?: string;
}

export interface ListSnapshotsOptions extends PageOptions, SnapshotFilters {}

/** Options for {@link WebFrostClient.searchSnapshotsPage}: the page plus the list's filters. */
export interface SearchSnapshotsOptions extends PageOptions, SnapshotFilters {}

/** Options for {@link WebFrostClient.iterateSnapshots}: the list filters plus a signal. */
export interface IterateSnapshotsOptions extends ListSnapshotsOptions, RequestOptions {}

/** Options for the `iterate*` methods: where to start, the page size, and a signal. */
export interface IterateOptions extends PageOptions, RequestOptions {}

/** Options for {@link WebFrostClient.createApiKey}. */
export interface CreateApiKeyOptions extends RequestOptions {
  /** When the key stops working: an ISO 8601 timestamp or a Date, in the future. Never by default. */
  expiresAt?: string | Date;
}

export type SnapshotPage = Page<Snapshot>;

/** Response from POST /import and POST /import/file (202 Accepted) */
export interface ImportResult {
  queued: number;
  skipped: number;
  total: number;
  format: ImportFormat;
}

/** Options for POST /import */
export interface ImportOptions {
  /** URL of a feed/file to fetch and parse */
  url?: string;
  /** Raw text content to parse (alternative to url) */
  content?: string;
  /** Format hint; auto-detected if omitted */
  format?: ImportFormat;
}

/** Scheduled archive job */
export interface Schedule {
  id: number;
  url: string;
  cron: string;
  createdAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  paused: boolean;
  lastStatus: ScheduleRunStatus | null;
  consecutiveFailures: number;
}

/** Response from POST /auth/login */
export interface LoginResult {
  ok: boolean;
}

/** Response from GET /auth/me */
export interface MeResult {
  username: string | null;
}

/** Response from GET /setup/status */
export interface SetupStatusResult {
  needsSetup: boolean;
  /** True when anonymous visitors may read the archive (older servers omit it; normalised to false). */
  publicRead: boolean;
  /** True when the server has WEBFROST_SETUP_TOKEN set, so setup must present it (false when omitted). */
  setupTokenRequired: boolean;
}

/** Response from POST /setup */
export interface SetupResult {
  apiKey: string;
}

/** Response from GET /stats */
export interface DashboardStats {
  snapshotCount: number;
  storageBytes: number;
  storageByExtractor: Record<string, number>;
  successRate: number;
  activeScheduleCount: number;
  failedToday: number;
}

/** Response from GET /settings/info */
export interface ServerInfo {
  version: string;
  storagePath: string;
  snapshotCount: number;
}

/** API key record from GET /settings/keys */
export interface ApiKey {
  id: string;
  name: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

/** Response from POST /settings/keys — includes raw key shown once */
export interface ApiKeyCreated extends ApiKey {
  rawKey: string;
}

/** Single record from GET /imports */
export interface ImportRecord {
  id: string;
  sourceUrl: string | null;
  format: ImportFormat;
  queued: number;
  skipped: number;
  createdAt: string;
}

/** Single result from GET /snapshots?q=term */
export interface SearchResult {
  id: number;
  url: string;
  /** HTML snippet with <mark> highlights around matching terms */
  snippet: string;
  rank: number;
  /** Snapshot status (`null` when the server did not report one). */
  status: SnapshotStatus | null;
  /** ISO creation timestamp ("" when the server did not report one). */
  createdAt: string;
  title: string | null;
  extractors: string[];
  tags: Tag[];
}

/** Paginated search results from GET /snapshots?q=term&page=&limit= */
export type SearchPage = Page<SearchResult>;
