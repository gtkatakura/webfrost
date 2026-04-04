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
}

/** Archive result extracted by a single extractor */
export interface ArchiveResult {
  id: number;
  extractor: string;
  content: string | null;
  createdAt: string;
}

/** Full snapshot detail from GET /snapshots/:id */
export interface SnapshotDetail extends Snapshot {
  archiveResults: ArchiveResult[];
}

export interface WebFrostClientOptions {
  /** Base URL of the WebFrost server, e.g. "http://localhost:3000" */
  baseUrl: string;
  /** API key for Bearer authentication. All requests will include Authorization: Bearer <apiKey>. */
  apiKey?: string;
}

export interface ListSnapshotsOptions {
  /** Page number (1-indexed). Defaults to 1. */
  page?: number;
  /** Items per page (1–100). Defaults to 20. */
  limit?: number;
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
}

/** Response from POST /setup */
export interface SetupResult {
  apiKey: string;
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

/** Single result from GET /snapshots?q=term */
export interface SearchResult {
  id: number;
  url: string;
  /** HTML snippet with <mark> highlights around matching terms */
  snippet: string;
  rank: number;
}
