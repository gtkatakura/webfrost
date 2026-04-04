import type {
  ApiKey,
  ApiKeyCreated,
  ArchiveResult,
  DashboardStats,
  ImportOptions,
  ImportResult,
  ListSnapshotsOptions,
  LoginResult,
  MeResult,
  Schedule,
  SearchResult,
  ServerInfo,
  SetupResult,
  SetupStatusResult,
  Snapshot,
  SnapshotCreated,
  SnapshotDetail,
  SnapshotPage,
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
  private readonly apiKey: string | undefined;

  constructor(options: WebFrostClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
  }

  private request(url: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    if (this.apiKey) headers.set("Authorization", `Bearer ${this.apiKey}`);
    return fetch(url, { ...init, headers });
  }

  /** Check whether first-run setup is needed (no admin user exists). */
  async getSetupStatus(): Promise<SetupStatusResult> {
    const res = await this.request(`${this.baseUrl}/setup/status`);
    if (!res.ok) throw new WebFrostError(res.status, res.statusText);
    return res.json() as Promise<SetupStatusResult>;
  }

  /** Complete first-run setup: create admin user and generate first API key. Sets a session cookie. */
  async completeSetup(username: string, password: string): Promise<SetupResult> {
    const res = await this.request(`${this.baseUrl}/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error: string };
      throw new WebFrostError(res.status, body.error);
    }
    return res.json() as Promise<SetupResult>;
  }

  /** Log in with username and password. Sets a session cookie on the browser. */
  async login(username: string, password: string): Promise<LoginResult> {
    const res = await this.request(`${this.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error: string };
      throw new WebFrostError(res.status, body.error);
    }
    return res.json() as Promise<LoginResult>;
  }

  /** Log out, clearing the session cookie. */
  async logout(): Promise<void> {
    await this.request(`${this.baseUrl}/auth/logout`, { method: "POST" });
  }

  /** Get the currently authenticated user. Returns null username for API-key auth. */
  async getMe(): Promise<MeResult> {
    const res = await this.request(`${this.baseUrl}/auth/me`);
    if (!res.ok) throw new WebFrostError(res.status, res.statusText);
    return res.json() as Promise<MeResult>;
  }

  /**
   * Create a new snapshot (fire-and-forget pipeline).
   * Resolves with the created snapshot stub (status "pending").
   * Throws {@link WebFrostError} on HTTP errors.
   */
  async createSnapshot(url: string): Promise<SnapshotCreated> {
    const res = await this.request(`${this.baseUrl}/snapshots`, {
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
   * List snapshots with optional pagination.
   * Returns a paginated result with items, total count, and pagination metadata.
   */
  async listSnapshots(options?: ListSnapshotsOptions): Promise<SnapshotPage> {
    const params = new URLSearchParams();
    if (options?.page !== undefined) params.set("page", String(options.page));
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    const qs = params.size > 0 ? `?${params.toString()}` : "";

    const res = await this.request(`${this.baseUrl}/snapshots${qs}`);

    if (!res.ok) {
      throw new WebFrostError(res.status, res.statusText);
    }

    const raw = (await res.json()) as {
      items: RawSnapshot[];
      total: number;
      page: number;
      limit: number;
    };
    return {
      items: raw.items.map(toSnapshot),
      total: raw.total,
      page: raw.page,
      limit: raw.limit,
    };
  }

  /**
   * Get a single snapshot with its archive results.
   * Returns `null` when the snapshot does not exist (404).
   * Throws {@link WebFrostError} for other HTTP errors.
   */
  async getSnapshot(id: number): Promise<SnapshotDetail | null> {
    const res = await this.request(`${this.baseUrl}/snapshots/${id}`);

    if (res.status === 404) {
      return null;
    }

    if (!res.ok) {
      throw new WebFrostError(res.status, res.statusText);
    }

    const raw = (await res.json()) as RawSnapshotDetail;
    return toSnapshotDetail(raw);
  }

  /**
   * Full-text search across snapshots.
   * Returns ranked results with HTML snippets (matching terms wrapped in <mark>).
   */
  async searchSnapshots(query: string): Promise<SearchResult[]> {
    const res = await this.request(`${this.baseUrl}/snapshots?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new WebFrostError(res.status, res.statusText);
    return res.json() as Promise<SearchResult[]>;
  }

  /** Delete a snapshot by id. Returns true if deleted, false if not found. */
  async deleteSnapshot(id: number): Promise<boolean> {
    const res = await this.request(`${this.baseUrl}/snapshots/${id}`, { method: "DELETE" });
    if (res.status === 404) return false;
    if (!res.ok) throw new WebFrostError(res.status, res.statusText);
    return true;
  }

  /** List all tags. */
  async listTags(): Promise<Tag[]> {
    const res = await this.request(`${this.baseUrl}/tags`);
    if (!res.ok) throw new WebFrostError(res.status, res.statusText);
    const raw = (await res.json()) as RawTag[];
    return raw.map(toTag);
  }

  /** Create a new tag. Throws WebFrostError(409) if name already exists. */
  async createTag(name: string, color?: string): Promise<Tag> {
    const res = await this.request(`${this.baseUrl}/tags`, {
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
    const res = await this.request(`${this.baseUrl}/tags/${id}`, { method: "DELETE" });
    if (res.status === 404) return false;
    if (!res.ok) throw new WebFrostError(res.status, res.statusText);
    return true;
  }

  /** List tags on a snapshot. */
  async listSnapshotTags(snapshotId: number): Promise<Tag[]> {
    const res = await this.request(`${this.baseUrl}/snapshots/${snapshotId}/tags`);
    if (res.status === 404) return [];
    if (!res.ok) throw new WebFrostError(res.status, res.statusText);
    const raw = (await res.json()) as RawTag[];
    return raw.map(toTag);
  }

  /** Add a tag to a snapshot. */
  async addTagToSnapshot(snapshotId: number, tagId: number): Promise<Tag> {
    const res = await this.request(`${this.baseUrl}/snapshots/${snapshotId}/tags`, {
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
    const res = await this.request(`${this.baseUrl}/snapshots/${snapshotId}/tags/${tagId}`, {
      method: "DELETE",
    });
    if (res.status === 404) return false;
    if (!res.ok) throw new WebFrostError(res.status, res.statusText);
    return true;
  }

  /** List all scheduled archive jobs. */
  async listSchedules(): Promise<Schedule[]> {
    const res = await this.request(`${this.baseUrl}/schedules`);
    if (!res.ok) throw new WebFrostError(res.status, res.statusText);
    return res.json() as Promise<Schedule[]>;
  }

  /** Create a new scheduled archive job. Throws WebFrostError on invalid url or cron. */
  async createSchedule(url: string, cron: string): Promise<Schedule> {
    const res = await this.request(`${this.baseUrl}/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, cron }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error: string };
      throw new WebFrostError(res.status, body.error);
    }
    return res.json() as Promise<Schedule>;
  }

  /** Delete a schedule by id. Returns true if deleted, false if not found. */
  async deleteSchedule(id: number): Promise<boolean> {
    const res = await this.request(`${this.baseUrl}/schedules/${id}`, { method: "DELETE" });
    if (res.status === 404) return false;
    if (!res.ok) throw new WebFrostError(res.status, res.statusText);
    return true;
  }

  /** Get dashboard stats: snapshot count, storage usage, success rate, schedule count, failed today. */
  async getStats(): Promise<DashboardStats> {
    const res = await this.request(`${this.baseUrl}/stats`);
    if (!res.ok) throw new WebFrostError(res.status, res.statusText);
    return res.json() as Promise<DashboardStats>;
  }

  /** Get server info: version, storage path, and total snapshot count. */
  async getServerInfo(): Promise<ServerInfo> {
    const res = await this.request(`${this.baseUrl}/settings/info`);
    if (!res.ok) throw new WebFrostError(res.status, res.statusText);
    return res.json() as Promise<ServerInfo>;
  }

  /** Change the admin account password. Throws WebFrostError on invalid current password. */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const res = await this.request(`${this.baseUrl}/auth/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error: string };
      throw new WebFrostError(res.status, body.error);
    }
  }

  /** List all active (non-revoked) API keys. */
  async listApiKeys(): Promise<ApiKey[]> {
    const res = await this.request(`${this.baseUrl}/settings/keys`);
    if (!res.ok) throw new WebFrostError(res.status, res.statusText);
    return res.json() as Promise<ApiKey[]>;
  }

  /** Create a new API key. The raw key is returned once and never stored. */
  async createApiKey(name: string): Promise<ApiKeyCreated> {
    const res = await this.request(`${this.baseUrl}/settings/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error: string };
      throw new WebFrostError(res.status, body.error);
    }
    return res.json() as Promise<ApiKeyCreated>;
  }

  /** Revoke an API key by id. Returns true if revoked, false if not found. */
  async revokeApiKey(id: string): Promise<boolean> {
    const res = await this.request(`${this.baseUrl}/settings/keys/${id}`, { method: "DELETE" });
    if (res.status === 404) return false;
    if (!res.ok) throw new WebFrostError(res.status, res.statusText);
    return true;
  }

  /**
   * Import URLs from a feed URL or raw content.
   * Returns counts of queued and skipped URLs plus the detected format.
   */
  async importUrls(options: ImportOptions): Promise<ImportResult> {
    const res = await this.request(`${this.baseUrl}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error: string };
      throw new WebFrostError(res.status, body.error);
    }
    return res.json() as Promise<ImportResult>;
  }
}
