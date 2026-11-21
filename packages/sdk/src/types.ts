/** Response from POST /snapshots (202 Accepted) */
export interface SnapshotCreated {
  id: number;
  url: string;
  status: string;
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
  status: string;
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
}

export interface ListSnapshotsOptions {
  /** Page number (1-indexed). Defaults to 1. */
  page?: number;
  /** Items per page (1–100). Defaults to 20. */
  limit?: number;
  /** Filter by snapshot status (e.g. "pending", "done", "failed"). */
  status?: string;
}

export interface SnapshotPage {
  items: Snapshot[];
  total: number;
  page: number;
  limit: number;
}

/** Response from POST /import (202 Accepted) */
export interface ImportResult {
  queued: number;
  skipped: number;
  total: number;
  format: "rss" | "opml" | "netscape" | "text";
}

/** Options for POST /import */
export interface ImportOptions {
  /** URL of a feed/file to fetch and parse */
  url?: string;
  /** Raw text content to parse (alternative to url) */
  content?: string;
  /** Format hint; auto-detected if omitted */
  format?: "rss" | "opml" | "netscape" | "text";
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
  lastStatus: string | null;
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
  id: number;
  sourceUrl: string | null;
  format: "rss" | "opml" | "netscape" | "text";
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
  /** Snapshot status ("" when the server did not report one). */
  status: string;
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
