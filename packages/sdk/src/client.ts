import type {
  ArchiveResult,
  Snapshot,
  SnapshotCreated,
  SnapshotDetail,
  WebFrostClientOptions,
} from "./types";

export class WebFrostError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WebFrostError";
  }
}

// Raw server shapes (server uses created_at, SDK exposes createdAt)
interface RawSnapshot {
  id: number;
  url: string;
  status: string;
  createdAt: string;
  extractors: string[];
}

interface RawArchiveResult {
  id: number;
  extractor: string;
  content: string | null;
  created_at: string;
}

interface RawSnapshotDetail {
  id: number;
  url: string;
  status: string;
  createdAt: string;
  extractors?: string[];
  archiveResults: RawArchiveResult[];
}

function toArchiveResult(r: RawArchiveResult): ArchiveResult {
  return { id: r.id, extractor: r.extractor, content: r.content, createdAt: r.created_at };
}

function toSnapshotDetail(raw: RawSnapshotDetail): SnapshotDetail {
  return {
    id: raw.id,
    url: raw.url,
    status: raw.status,
    createdAt: raw.createdAt,
    extractors: raw.extractors ?? [],
    archiveResults: raw.archiveResults.map(toArchiveResult),
  };
}

export class WebFrostClient {
  private readonly baseUrl: string;

  constructor(options: WebFrostClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
  }

  /**
   * Create a new snapshot (fire-and-forget pipeline).
   * Resolves with the created snapshot stub (status "pending").
   * Throws {@link WebFrostError} on HTTP errors.
   */
  async createSnapshot(url: string): Promise<SnapshotCreated> {
    const res = await fetch(`${this.baseUrl}/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as {
        error: string;
      };
      throw new WebFrostError(res.status, body.error);
    }

    return res.json() as Promise<SnapshotCreated>;
  }

  /**
   * List all snapshots.
   */
  async listSnapshots(): Promise<Snapshot[]> {
    const res = await fetch(`${this.baseUrl}/snapshots`);

    if (!res.ok) {
      throw new WebFrostError(res.status, res.statusText);
    }

    return res.json() as Promise<RawSnapshot[]>;
  }

  /**
   * Get a single snapshot with its archive results.
   * Returns `null` when the snapshot does not exist (404).
   * Throws {@link WebFrostError} for other HTTP errors.
   */
  async getSnapshot(id: number): Promise<SnapshotDetail | null> {
    const res = await fetch(`${this.baseUrl}/snapshots/${id}`);

    if (res.status === 404) {
      return null;
    }

    if (!res.ok) {
      throw new WebFrostError(res.status, res.statusText);
    }

    const raw = (await res.json()) as RawSnapshotDetail;
    return toSnapshotDetail(raw);
  }
}
