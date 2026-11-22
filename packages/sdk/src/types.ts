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
export interface Snapshot {
  id: number;
  url: string;
  status: SnapshotStatus;
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

export interface ListSnapshotsOptions extends PageOptions {
  /** Filter by snapshot status. */
  status?: SnapshotStatus;
}

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
