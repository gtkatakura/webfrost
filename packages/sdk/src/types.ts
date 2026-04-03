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
}

/** Single result from GET /snapshots?q=term */
export interface SearchResult {
  id: number;
  url: string;
  /** HTML snippet with <mark> highlights around matching terms */
  snippet: string;
  rank: number;
}
