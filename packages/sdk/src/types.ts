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

/** Single snapshot from GET /snapshots list */
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
  /** URL to the screenshot archive if available, null otherwise */
  screenshotUrl: string | null;
}

/** Archive result extracted by a single extractor */
export interface ArchiveResult {
  id: number;
  extractor: string;
  content: string | null;
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
  /** API base URL including the `/api` prefix, e.g. "http://localhost:3000/api" */
  baseUrl: string;
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

export interface ListSnapshotsOptions {
  /** Page number (1-indexed). Defaults to 1. */
  page?: number;
  /** Items per page (1-100). Defaults to 20. */
  limit?: number;
  /** Filter by snapshot status. */
  status?: SnapshotStatus;
}

/** Options for {@link WebFrostClient.iterateSnapshots}: the list filters plus a signal. */
export interface IterateSnapshotsOptions extends ListSnapshotsOptions, RequestOptions {}

export interface SnapshotPage {
  items: Snapshot[];
  total: number;
  page: number;
  limit: number;
}

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
export interface SearchPage {
  items: SearchResult[];
  total: number;
  page: number;
  limit: number;
}
