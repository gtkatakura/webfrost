import type {
  ApiKey,
  ApiKeyCreated,
  ArchiveResult,
  DashboardStats,
  ImportOptions,
  ImportRecord,
  ImportResult,
  ListSnapshotsOptions,
  LoginResult,
  MeResult,
  Schedule,
  SearchPage,
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
  /** Seconds to wait before retrying, parsed from the `Retry-After` header (typically on 429). */
  public readonly retryAfter?: number;

  constructor(
    public readonly status: number,
    message: string,
    retryAfter?: number,
  ) {
    super(message);
    this.name = "WebFrostError";
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

/** Parse a `Retry-After` header given as delta-seconds (or an HTTP date). */
function parseRetryAfter(res: Response): number | undefined {
  const value = res.headers?.get("Retry-After");
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function httpError(res: Response, message: string): WebFrostError {
  return new WebFrostError(res.status, message, parseRetryAfter(res));
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
  title: string | null;
  excerpt: string | null;
  screenshotUrl: string | null;
}

interface RawSearchResult {
  id: number;
  url: string;
  snippet: string;
  rank: number;
  status?: string;
  createdAt?: string;
  title?: string | null;
  extractors?: string[];
  tags?: RawTag[];
}

interface RawArchiveResult {
  id: number;
  extractor: string;
  content: string | null;
  created_at?: string;
  createdAt?: string;
}

interface RawSnapshotDetail {
  id: number;
  url: string;
  status: string;
  createdAt: string;
  extractors?: string[];
  tags?: RawTag[];
  archiveResults: RawArchiveResult[];
  title?: string | null;
  excerpt?: string | null;
  screenshotUrl?: string | null;
  extractorMeta?: Record<
    string,
    {
      status: "success" | "failed";
      durationMs: number | null;
      fileSizeBytes: number | null;
      error?: string;
    }
  >;
}

function toTag(r: RawTag): Tag {
  return { id: r.id, name: r.name, slug: r.slug, color: r.color, createdAt: r.createdAt };
}

function toArchiveResult(r: RawArchiveResult): ArchiveResult {
  return {
    id: r.id,
    extractor: r.extractor,
    content: r.content,
    createdAt: r.created_at ?? r.createdAt ?? "",
  };
}

function toSnapshot(raw: RawSnapshot): Snapshot {
  return {
    id: raw.id,
    url: raw.url,
    status: raw.status,
    createdAt: raw.createdAt,
    extractors: raw.extractors ?? [],
    tags: (raw.tags ?? []).map(toTag),
    title: raw.title ?? null,
    excerpt: raw.excerpt ?? null,
    screenshotUrl: raw.screenshotUrl ?? null,
  };
}

function toSearchResult(raw: RawSearchResult): SearchResult {
  return {
    id: raw.id,
    url: raw.url,
    snippet: raw.snippet,
    rank: raw.rank,
    status: raw.status ?? "",
    createdAt: raw.createdAt ?? "",
    title: raw.title ?? null,
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
    title: raw.title ?? null,
    excerpt: raw.excerpt ?? null,
    screenshotUrl: raw.screenshotUrl ?? null,
    extractorMeta: raw.extractorMeta ?? {},
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
    if (!res.ok) throw httpError(res, res.statusText);
    const body = (await res.json()) as {
      needsSetup: boolean;
      publicRead?: boolean;
      setupTokenRequired?: boolean;
    };
    return {
      needsSetup: body.needsSetup,
      publicRead: body.publicRead === true,
      setupTokenRequired: body.setupTokenRequired === true,
    };
  }

  /**
   * Complete first-run setup: create admin user and generate first API key. Sets a session cookie.
   * Pass `setupToken` when the server requires one (WEBFROST_SETUP_TOKEN).
   */
  async completeSetup(
    username: string,
    password: string,
    setupToken?: string,
  ): Promise<SetupResult> {
    const res = await this.request(`${this.baseUrl}/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        setupToken ? { username, password, setupToken } : { username, password },
      ),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error: string };
      throw httpError(res, body.error);
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
      throw httpError(res, body.error);
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
    if (!res.ok) throw httpError(res, res.statusText);
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
      throw httpError(res, body.error);
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
    if (options?.status !== undefined) params.set("status", options.status);
    const qs = params.size > 0 ? `?${params.toString()}` : "";

    const res = await this.request(`${this.baseUrl}/snapshots${qs}`);

    if (!res.ok) {
      throw httpError(res, res.statusText);
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
      throw httpError(res, res.statusText);
    }

    const raw = (await res.json()) as RawSnapshotDetail;
    return toSnapshotDetail(raw);
  }

  /**
   * Full-text search across snapshots.
   * Returns ranked results with HTML snippets (matching terms wrapped in <mark>).
   */
  async searchSnapshots(query: string): Promise<SearchResult[]> {
    return (await this.searchSnapshotsPage(query)).items;
  }

  /**
   * Full-text search with pagination.
   * Returns the page of ranked results plus the total match count.
   */
  async searchSnapshotsPage(
    query: string,
    options?: { page?: number; limit?: number },
  ): Promise<SearchPage> {
    const params = new URLSearchParams({ q: query });
    if (options?.page !== undefined) params.set("page", String(options.page));
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    const res = await this.request(`${this.baseUrl}/snapshots?${params.toString()}`);
    if (!res.ok) throw httpError(res, res.statusText);
    const raw = (await res.json()) as {
      items: RawSearchResult[];
      total?: number;
      page?: number;
      limit?: number;
    };
    return {
      items: raw.items.map(toSearchResult),
      total: raw.total ?? raw.items.length,
      page: raw.page ?? options?.page ?? 1,
      limit: raw.limit ?? options?.limit ?? raw.items.length,
    };
  }

  /** Delete a snapshot by id. Returns true if deleted, false if not found. */
  async deleteSnapshot(id: number): Promise<boolean> {
    const res = await this.request(`${this.baseUrl}/snapshots/${id}`, { method: "DELETE" });
    if (res.status === 404) return false;
    if (!res.ok) throw httpError(res, res.statusText);
    return true;
  }

  /** List all tags. */
  async listTags(): Promise<Tag[]> {
    const res = await this.request(`${this.baseUrl}/tags`);
    if (!res.ok) throw httpError(res, res.statusText);
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
      throw httpError(res, body.error);
    }
    return toTag((await res.json()) as RawTag);
  }

  /** Delete a tag by id. Returns true if deleted, false if not found. */
  async deleteTag(id: number): Promise<boolean> {
    const res = await this.request(`${this.baseUrl}/tags/${id}`, { method: "DELETE" });
    if (res.status === 404) return false;
    if (!res.ok) throw httpError(res, res.statusText);
    return true;
  }

  /** List tags on a snapshot. */
  async listSnapshotTags(snapshotId: number): Promise<Tag[]> {
    const res = await this.request(`${this.baseUrl}/snapshots/${snapshotId}/tags`);
    if (res.status === 404) return [];
    if (!res.ok) throw httpError(res, res.statusText);
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
      throw httpError(res, body.error);
    }
    return toTag((await res.json()) as RawTag);
  }

  /** Remove a tag from a snapshot. */
  async removeTagFromSnapshot(snapshotId: number, tagId: number): Promise<boolean> {
    const res = await this.request(`${this.baseUrl}/snapshots/${snapshotId}/tags/${tagId}`, {
      method: "DELETE",
    });
    if (res.status === 404) return false;
    if (!res.ok) throw httpError(res, res.statusText);
    return true;
  }

  /** List all scheduled archive jobs. */
  async listSchedules(): Promise<Schedule[]> {
    const res = await this.request(`${this.baseUrl}/schedules`);
    if (!res.ok) throw httpError(res, res.statusText);
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
      throw httpError(res, body.error);
    }
    return res.json() as Promise<Schedule>;
  }

  /** Update a schedule (e.g. pause/resume). Returns the updated schedule. */
  async updateSchedule(id: number, update: { paused: boolean }): Promise<Schedule> {
    const res = await this.request(`${this.baseUrl}/schedules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error: string };
      throw httpError(res, body.error);
    }
    return res.json() as Promise<Schedule>;
  }

  /** Delete a schedule by id. Returns true if deleted, false if not found. */
  async deleteSchedule(id: number): Promise<boolean> {
    const res = await this.request(`${this.baseUrl}/schedules/${id}`, { method: "DELETE" });
    if (res.status === 404) return false;
    if (!res.ok) throw httpError(res, res.statusText);
    return true;
  }

  /** Get dashboard stats: snapshot count, storage usage, success rate, schedule count, failed today. */
  async getStats(): Promise<DashboardStats> {
    const res = await this.request(`${this.baseUrl}/stats`);
    if (!res.ok) throw httpError(res, res.statusText);
    return res.json() as Promise<DashboardStats>;
  }

  /** Get server info: version, storage path, and total snapshot count. */
  async getServerInfo(): Promise<ServerInfo> {
    const res = await this.request(`${this.baseUrl}/settings/info`);
    if (!res.ok) throw httpError(res, res.statusText);
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
      throw httpError(res, body.error);
    }
  }

  /** List all active (non-revoked) API keys. */
  async listApiKeys(): Promise<ApiKey[]> {
    const res = await this.request(`${this.baseUrl}/settings/keys`);
    if (!res.ok) throw httpError(res, res.statusText);
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
      throw httpError(res, body.error);
    }
    return res.json() as Promise<ApiKeyCreated>;
  }

  /** Revoke an API key by id. Returns true if revoked, false if not found. */
  async revokeApiKey(id: string): Promise<boolean> {
    const res = await this.request(`${this.baseUrl}/settings/keys/${id}`, { method: "DELETE" });
    if (res.status === 404) return false;
    if (!res.ok) throw httpError(res, res.statusText);
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
      throw httpError(res, body.error);
    }
    return res.json() as Promise<ImportResult>;
  }

  /** List past import records from GET /imports. */
  async listImports(): Promise<ImportRecord[]> {
    const res = await this.request(`${this.baseUrl}/imports`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error: string };
      throw httpError(res, body.error);
    }
    return res.json() as Promise<ImportRecord[]>;
  }
}
