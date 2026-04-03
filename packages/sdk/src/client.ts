import type {
  ArchiveResult,
  Snapshot,
  SnapshotCreated,
  SnapshotDetail,
  Tag,
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
interface RawTag {
  id: number;
  name: string;
  slug: string;
  color: string | null;
  createdAt: string;
}

interface RawSnapshot {
  id: number;
  url: string;
  status: string;
  createdAt: string;
  extractors: string[];
  tags: RawTag[];
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
  tags?: RawTag[];
  archiveResults: RawArchiveResult[];
}

function toTag(r: RawTag): Tag {
  return { id: r.id, name: r.name, slug: r.slug, color: r.color, createdAt: r.createdAt };
}

function toArchiveResult(r: RawArchiveResult): ArchiveResult {
  return { id: r.id, extractor: r.extractor, content: r.content, createdAt: r.created_at };
}

function toSnapshot(raw: RawSnapshot): Snapshot {
  return {
    id: raw.id,
    url: raw.url,
    status: raw.status,
    createdAt: raw.createdAt,
    extractors: raw.extractors ?? [],
    tags: (raw.tags ?? []).map(toTag),
  };
}

function toSnapshotDetail(raw: RawSnapshotDetail): SnapshotDetail {
  return {
    id: raw.id,
    url: raw.url,
    status: raw.status,
    createdAt: raw.createdAt,
    extractors: raw.extractors ?? [],
    tags: (raw.tags ?? []).map(toTag),
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

    const raw = (await res.json()) as RawSnapshot[];
    return raw.map(toSnapshot);
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

  /** Delete a snapshot by id. Returns true if deleted, false if not found. */
  async deleteSnapshot(id: number): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/snapshots/${id}`, { method: "DELETE" });
    if (res.status === 404) return false;
    if (!res.ok) throw new WebFrostError(res.status, res.statusText);
    return true;
  }

  /** List all tags. */
  async listTags(): Promise<Tag[]> {
    const res = await fetch(`${this.baseUrl}/tags`);
    if (!res.ok) throw new WebFrostError(res.status, res.statusText);
    const raw = (await res.json()) as RawTag[];
    return raw.map(toTag);
  }

  /** Create a new tag. Throws WebFrostError(409) if name already exists. */
  async createTag(name: string, color?: string): Promise<Tag> {
    const res = await fetch(`${this.baseUrl}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, ...(color !== undefined ? { color } : {}) }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error: string };
      throw new WebFrostError(res.status, body.error);
    }
    return toTag((await res.json()) as RawTag);
  }

  /** Delete a tag by id. Returns true if deleted, false if not found. */
  async deleteTag(id: number): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/tags/${id}`, { method: "DELETE" });
    if (res.status === 404) return false;
    if (!res.ok) throw new WebFrostError(res.status, res.statusText);
    return true;
  }

  /** List tags on a snapshot. */
  async listSnapshotTags(snapshotId: number): Promise<Tag[]> {
    const res = await fetch(`${this.baseUrl}/snapshots/${snapshotId}/tags`);
    if (res.status === 404) return [];
    if (!res.ok) throw new WebFrostError(res.status, res.statusText);
    const raw = (await res.json()) as RawTag[];
    return raw.map(toTag);
  }

  /** Add a tag to a snapshot. */
  async addTagToSnapshot(snapshotId: number, tagId: number): Promise<Tag> {
    const res = await fetch(`${this.baseUrl}/snapshots/${snapshotId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagId }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error: string };
      throw new WebFrostError(res.status, body.error);
    }
    return toTag((await res.json()) as RawTag);
  }

  /** Remove a tag from a snapshot. */
  async removeTagFromSnapshot(snapshotId: number, tagId: number): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/snapshots/${snapshotId}/tags/${tagId}`, {
      method: "DELETE",
    });
    if (res.status === 404) return false;
    if (!res.ok) throw new WebFrostError(res.status, res.statusText);
    return true;
  }
}
