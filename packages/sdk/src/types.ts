/** Response from POST /snapshots (202 Accepted) */
export interface SnapshotCreated {
  id: number;
  url: string;
  status: string;
}

/** Single snapshot from GET /snapshots list */
export interface Snapshot {
  id: number;
  url: string;
  status: string;
  createdAt: string;
  /** Extractor names that have produced results for this snapshot (e.g. ["warc", "readability"]) */
  extractors: string[];
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
