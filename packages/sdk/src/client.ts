import { WebFrostError, parseError } from "./errors.js";
import {
  type RawSnapshot,
  type RawSnapshotDetail,
  type RawTag,
  toSearchResult,
  toSnapshot,
  toSnapshotDetail,
  toTag,
} from "./mappers.js";
import type {
  ApiKey,
  ApiKeyCreated,
  ArchiveUrlKind,
  CreateApiKeyOptions,
  DashboardStats,
  ImportFormat,
  ImportOptions,
  ImportRecord,
  ImportResult,
  IterateOptions,
  IterateSnapshotsOptions,
  ListSnapshotsOptions,
  LoginResult,
  MeResult,
  Page,
  PageOptions,
  RequestOptions,
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
} from "./types.js";

export { WebFrostError } from "./errors.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;
/** Statuses worth retrying: rate limited, or a gateway/upstream hiccup. */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

interface SendOptions {
  /** JSON-serialised unless it is a FormData. */
  body?: unknown;
  signal?: AbortSignal | undefined;
  /** Non-2xx statuses the caller handles itself (e.g. 404 -> null) instead of throwing. */
  allow?: readonly number[];
  /** The caller consumes the body after the call, so the timeout must not outlive the headers. */
  streaming?: boolean;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortedError(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortedError(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortedError(signal?: AbortSignal): WebFrostError {
  return new WebFrostError(0, "request aborted", undefined, "ABORTED", { cause: signal?.reason });
}

function isRetryable(err: WebFrostError): boolean {
  return (
    err.code === "NETWORK_ERROR" || err.code === "TIMEOUT" || RETRYABLE_STATUSES.has(err.status)
  );
}

/** Where version 1 of the HTTP API lives, below the server's base URL. */
const API_PATH = "/api/v1";

let warnedLegacyBaseUrl = false;

/**
 * The server's base URL without a trailing slash. A legacy base URL that already names the API
 * (`.../api`, or `.../api/v1`) loses that suffix, with a one-time warning: the client adds the
 * versioned path itself.
 */
function normaliseBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const match = /\/api(?:\/v1)?$/.exec(trimmed);
  if (!match) return trimmed;
  if (!warnedLegacyBaseUrl) {
    warnedLegacyBaseUrl = true;
    console.warn(
      `[@webfrost/sdk] baseUrl should be the server's origin (e.g. "http://localhost:3000"), not the API path: dropping "${match[0]}" from "${baseUrl}". The client adds ${API_PATH} itself.`,
    );
  }
  return trimmed.slice(0, match.index);
}

/** Page and limit as query parameters (only the ones given). */
function pageQuery(options: { page?: number; limit?: number } | undefined): URLSearchParams {
  const params = new URLSearchParams();
  if (options?.page !== undefined) params.set("page", String(options.page));
  if (options?.limit !== undefined) params.set("limit", String(options.limit));
  return params;
}

function withQuery(path: string, params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export class WebFrostClient {
  /** The server's base URL, normalised (no trailing slash, no `/api` suffix). */
  private readonly baseUrl: string;
  /** `baseUrl` plus the versioned API path: every request goes below it. */
  private readonly apiUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly credentials: RequestCredentials;

  constructor(options: WebFrostClientOptions = {}) {
    this.baseUrl = normaliseBaseUrl(options.baseUrl ?? "");
    this.apiUrl = `${this.baseUrl}${API_PATH}`;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetch;
    this.retries = Math.max(0, Math.floor(options.retries ?? 0));
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
    this.credentials = options.credentials ?? "same-origin";
  }

  // ---------------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------------

  /**
   * Send one request and parse its response, applying the timeout, abort signal and (for
   * idempotent GET/HEAD requests only) retries. Every failure surfaces as a WebFrostError.
   *
   * DELETE is deliberately not retried: if the first attempt reached the server but the reply
   * was lost, the retry would see 404 and report "not found" for something that was deleted.
   */
  private async send<T>(
    method: string,
    path: string,
    options: SendOptions,
    parse: (res: Response) => Promise<T>,
  ): Promise<T> {
    const idempotent = method === "GET" || method === "HEAD";
    const maxRetries = idempotent ? this.retries : 0;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.attempt(method, path, options, parse);
      } catch (err) {
        if (!(err instanceof WebFrostError) || attempt >= maxRetries || !isRetryable(err))
          throw err;
        const delay = this.backoffDelay(attempt, err.retryAfter);
        if (delay === null) throw err;
        await sleep(delay, options.signal);
      }
    }
  }

  /** Milliseconds to wait before the next attempt, or null when waiting is not worth it. */
  private backoffDelay(attempt: number, retryAfterSecs: number | undefined): number | null {
    if (retryAfterSecs !== undefined) {
      const ms = retryAfterSecs * 1000;
      return ms > this.maxRetryDelayMs ? null : ms;
    }
    const exp = Math.min(this.maxRetryDelayMs, this.retryDelayMs * 2 ** attempt);
    // Jitter between 50% and 100% so clients that failed together do not retry together.
    return Math.round(exp * (0.5 + Math.random() / 2));
  }

  private async attempt<T>(
    method: string,
    path: string,
    options: SendOptions,
    parse: (res: Response) => Promise<T>,
  ): Promise<T> {
    const { signal, body, allow = [], streaming = false } = options;
    if (signal?.aborted) throw abortedError(signal);

    const headers = new Headers();
    if (this.apiKey) headers.set("Authorization", `Bearer ${this.apiKey}`);
    let payload: BodyInit | undefined;
    if (body instanceof FormData) {
      payload = body; // fetch sets the multipart boundary itself
    } else if (body !== undefined) {
      headers.set("Content-Type", "application/json");
      payload = JSON.stringify(body);
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const timer =
      this.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, this.timeoutMs)
        : undefined;

    const wrap = (err: unknown): WebFrostError => {
      if (err instanceof WebFrostError) return err;
      if (timedOut) {
        return new WebFrostError(
          0,
          `request timed out after ${this.timeoutMs}ms`,
          undefined,
          "TIMEOUT",
          { cause: err },
        );
      }
      if (signal?.aborted) return abortedError(signal);
      if (err instanceof SyntaxError) {
        return new WebFrostError(0, "response was not valid JSON", undefined, "INVALID_RESPONSE", {
          cause: err,
        });
      }
      const detail = err instanceof Error ? err.message : String(err);
      return new WebFrostError(0, `network error: ${detail}`, undefined, "NETWORK_ERROR", {
        cause: err,
      });
    };

    try {
      // Looked up per call so a replaced global fetch (tests, polyfills) is honoured.
      const doFetch = this.fetchImpl ?? globalThis.fetch;
      const res = await doFetch(`${this.apiUrl}${path}`, {
        method,
        headers,
        credentials: this.credentials,
        signal: controller.signal,
        ...(payload !== undefined ? { body: payload } : {}),
      });
      if (!res.ok && !allow.includes(res.status)) throw await parseError(res);
      return await parse(res);
    } catch (err) {
      throw wrap(err);
    } finally {
      clearTimeout(timer);
      // A streamed body keeps honouring the caller's signal after this method returns.
      if (!streaming) signal?.removeEventListener("abort", onAbort);
    }
  }

  private json<T>(method: string, path: string, options: SendOptions = {}): Promise<T> {
    return this.send(method, path, options, (res) => res.json() as Promise<T>);
  }

  /** A request whose response body is ignored. */
  private async none(method: string, path: string, options: SendOptions = {}): Promise<void> {
    await this.send(method, path, options, async (res) => {
      await res.arrayBuffer().catch(() => undefined);
    });
  }

  /** DELETE-style request: true when it succeeded, false on 404. */
  private async remove(path: string, request?: RequestOptions): Promise<boolean> {
    return this.send("DELETE", path, { signal: request?.signal, allow: [404] }, async (res) => {
      await res.arrayBuffer().catch(() => undefined);
      return res.status !== 404;
    });
  }

  // ---------------------------------------------------------------------------
  // Setup and auth
  // ---------------------------------------------------------------------------

  /** Check whether first-run setup is needed (no admin user exists). */
  async getSetupStatus(request?: RequestOptions): Promise<SetupStatusResult> {
    const body = await this.json<{
      needsSetup: boolean;
      publicRead?: boolean;
      setupTokenRequired?: boolean;
    }>("GET", "/setup/status", { signal: request?.signal });
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
  completeSetup(
    username: string,
    password: string,
    setupToken?: string,
    request?: RequestOptions,
  ): Promise<SetupResult> {
    return this.json("POST", "/setup", {
      body: setupToken ? { username, password, setupToken } : { username, password },
      signal: request?.signal,
    });
  }

  /**
   * Log in with username and password. Sets a session cookie, which only a browser keeps: from
   * the browser, pass `credentials: "include"` to the client when the API is on another origin.
   * Outside the browser, authenticate with an API key instead.
   */
  login(username: string, password: string, request?: RequestOptions): Promise<LoginResult> {
    return this.json("POST", "/auth/login", {
      body: { username, password },
      signal: request?.signal,
    });
  }

  /** Log out, clearing the session cookie. Already being logged out (401) is not an error. */
  logout(request?: RequestOptions): Promise<void> {
    return this.none("POST", "/auth/logout", { signal: request?.signal, allow: [401] });
  }

  /** Get the currently authenticated user. Returns null username for API-key auth. */
  getMe(request?: RequestOptions): Promise<MeResult> {
    return this.json("GET", "/auth/me", { signal: request?.signal });
  }

  /** Change the admin account password. Throws WebFrostError on invalid current password. */
  changePassword(
    currentPassword: string,
    newPassword: string,
    request?: RequestOptions,
  ): Promise<void> {
    return this.none("POST", "/auth/change-password", {
      body: { currentPassword, newPassword },
      signal: request?.signal,
    });
  }

  // ---------------------------------------------------------------------------
  // Snapshots
  //
  // Not-found semantics: looking up one thing that is missing (`getSnapshot`) resolves `null`;
  // deleting something that is missing (`delete*`, `remove*`) resolves `false`; listing the
  // children of a missing parent (`listSnapshotTags`) resolves an empty page. Everything else treats a
  // 404 as an error and throws a WebFrostError with code NOT_FOUND.
  // ---------------------------------------------------------------------------

  /** Turn a server-relative path ("/api/v1/...") into a URL under {@link baseUrl}. */
  private readonly resolve = (path: string): string =>
    path.startsWith("/") ? `${this.baseUrl}${path}` : path;

  /** GET one page of a list endpoint and map its items. */
  private async page<Raw, T>(
    path: string,
    params: URLSearchParams,
    map: (raw: Raw) => T,
    request?: RequestOptions,
    allow?: readonly number[],
  ): Promise<Page<T> | null> {
    return this.send(
      "GET",
      withQuery(path, params),
      { signal: request?.signal, ...(allow ? { allow } : {}) },
      async (res) => {
        if (res.status === 404 && allow?.includes(404)) return null;
        const raw = (await res.json()) as Page<Raw>;
        return { items: raw.items.map(map), total: raw.total, page: raw.page, limit: raw.limit };
      },
    );
  }

  /** Same as {@link page} for endpoints that never answer 404. */
  private async pageOf<Raw, T>(
    path: string,
    options: PageOptions | undefined,
    map: (raw: Raw) => T,
    request?: RequestOptions,
  ): Promise<Page<T>> {
    return (await this.page(path, pageQuery(options), map, request)) as Page<T>;
  }

  /** Walk a list page by page, lazily, until it is exhausted or the consumer stops. */
  private async *pages<T>(
    fetchPage: (page: number, limit: number, request: RequestOptions) => Promise<Page<T>>,
    options: IterateOptions,
    defaultLimit = 100,
  ): AsyncGenerator<T> {
    const { signal, page: startPage = 1, limit = defaultLimit } = options;
    let page = startPage;
    for (;;) {
      const result = await fetchPage(page, limit, { signal });
      yield* result.items;
      // Trust the limit the server applied: it may have capped the one requested.
      if (result.items.length === 0 || result.page * result.limit >= result.total) return;
      page = result.page + 1;
    }
  }

  /**
   * Create a new snapshot (fire-and-forget pipeline).
   * Resolves with the created snapshot stub (status "pending").
   * Throws {@link WebFrostError} on HTTP errors.
   */
  createSnapshot(
    url: string,
    request?: RequestOptions & { colorScheme?: "light" | "dark" },
  ): Promise<SnapshotCreated> {
    const body = request?.colorScheme ? { url, colorScheme: request.colorScheme } : { url };
    return this.json("POST", "/snapshots", { body, signal: request?.signal });
  }

  /**
   * List snapshots, newest first, one page at a time (20 per page unless `limit` says otherwise).
   */
  async listSnapshots(
    options?: ListSnapshotsOptions,
    request?: RequestOptions,
  ): Promise<SnapshotPage> {
    const params = pageQuery(options);
    if (options?.status !== undefined) params.set("status", options.status);
    return (await this.page(
      "/snapshots",
      params,
      (raw: RawSnapshot) => toSnapshot(raw, this.resolve),
      request,
    )) as SnapshotPage;
  }

  /**
   * Iterate over every snapshot matching the filters, fetching pages lazily (100 per page unless
   * `limit` says otherwise). Starts at `page` (default 1). Stops early if the consumer breaks out
   * of the loop or the signal aborts.
   *
   * ```ts
   * for await (const snapshot of client.iterateSnapshots({ status: "done" })) { ... }
   * ```
   */
  iterateSnapshots(options: IterateSnapshotsOptions = {}): AsyncGenerator<Snapshot> {
    const { signal, page, limit, ...filters } = options;
    return this.pages(
      (p, l, request) => this.listSnapshots({ ...filters, page: p, limit: l }, request),
      {
        signal,
        ...(page !== undefined ? { page } : {}),
        ...(limit !== undefined ? { limit } : {}),
      },
    );
  }

  /**
   * Get a single snapshot with its archive results.
   * Returns `null` when the snapshot does not exist (404).
   * Throws {@link WebFrostError} for other HTTP errors.
   */
  getSnapshot(id: number, request?: RequestOptions): Promise<SnapshotDetail | null> {
    return this.send(
      "GET",
      `/snapshots/${id}`,
      { signal: request?.signal, allow: [404] },
      async (res) =>
        res.status === 404
          ? null
          : toSnapshotDetail((await res.json()) as RawSnapshotDetail, this.resolve),
    );
  }

  /**
   * Full-text search across snapshots: the first page of ranked results (20 unless the server
   * says otherwise), each with an HTML snippet (matching terms wrapped in <mark>).
   */
  async searchSnapshots(query: string, request?: RequestOptions): Promise<SearchResult[]> {
    return (await this.searchSnapshotsPage(query, undefined, request)).items;
  }

  /**
   * Full-text search with pagination.
   * Returns the page of ranked results plus the total match count.
   */
  async searchSnapshotsPage(
    query: string,
    options?: PageOptions,
    request?: RequestOptions,
  ): Promise<SearchPage> {
    const params = pageQuery(options);
    params.set("q", query);
    return (await this.page("/snapshots", params, toSearchResult, request)) as SearchPage;
  }

  /** Delete a snapshot by id. Returns true if deleted, false if not found. */
  deleteSnapshot(id: number, request?: RequestOptions): Promise<boolean> {
    return this.remove(`/snapshots/${id}`, request);
  }

  /**
   * Archive a snapshot again, in place: same id, URL and color scheme, its results replaced. Resolves
   * once it is queued (status "pending"; poll {@link getSnapshot}). Throws {@link WebFrostError} with
   * `NOT_FOUND`, or `CONFLICT` while the snapshot is still being archived.
   */
  retrySnapshot(id: number, request?: RequestOptions): Promise<{ id: number; status: "pending" }> {
    return this.json("POST", `/snapshots/${id}/retry`, { signal: request?.signal });
  }

  /**
   * URL of an archived result, for `<a href>`, `<img src>` or `<iframe src>`.
   * "download" serves the stored file (or the extractor's JSON); "preview" serves sandboxed
   * HTML for the extractors that have one. The URL carries no credentials: the browser sends the
   * session cookie, and an API key cannot be put in a URL, so use {@link downloadArchive} to
   * fetch with a key. Same as an archive result's `downloadUrl` / `previewUrl`.
   */
  archiveUrl(id: number, extractor: string, kind: ArchiveUrlKind = "download"): string {
    return `${this.apiUrl}${this.archivePath(id, extractor, kind)}`;
  }

  private archivePath(id: number, extractor: string, kind: ArchiveUrlKind): string {
    return `/snapshots/${id}/archives/${encodeURIComponent(extractor)}/${kind}`;
  }

  /**
   * Fetch an archived result as a `Response`, with the client's auth, timeout and abort signal
   * applied to the request (not to reading the body). Read it with `.blob()`, `.arrayBuffer()`
   * or `.body`. Throws WebFrostError (NOT_FOUND when there is no such result).
   */
  downloadArchive(
    id: number,
    extractor: string,
    options?: RequestOptions & { kind?: ArchiveUrlKind },
  ): Promise<Response> {
    const path = this.archivePath(id, extractor, options?.kind ?? "download");
    return this.send("GET", path, { signal: options?.signal, streaming: true }, async (res) => res);
  }

  // ---------------------------------------------------------------------------
  // Tags
  // ---------------------------------------------------------------------------

  /** List tags, by name, one page at a time. */
  listTags(options?: PageOptions, request?: RequestOptions): Promise<Page<Tag>> {
    return this.pageOf("/tags", options, toTag, request);
  }

  /** Iterate over every tag, fetching pages lazily. */
  iterateTags(options: IterateOptions = {}): AsyncGenerator<Tag> {
    return this.pages((page, limit, request) => this.listTags({ page, limit }, request), options);
  }

  /** Create a new tag. Throws WebFrostError (code CONFLICT) if the name already exists. */
  async createTag(name: string, color?: string, request?: RequestOptions): Promise<Tag> {
    const raw = await this.json<RawTag>("POST", "/tags", {
      body: { name, ...(color !== undefined ? { color } : {}) },
      signal: request?.signal,
    });
    return toTag(raw);
  }

  /** Delete a tag by id. Returns true if deleted, false if not found. */
  deleteTag(id: number, request?: RequestOptions): Promise<boolean> {
    return this.remove(`/tags/${id}`, request);
  }

  /** List the tags on a snapshot. Resolves an empty page when the snapshot does not exist. */
  async listSnapshotTags(
    snapshotId: number,
    options?: PageOptions,
    request?: RequestOptions,
  ): Promise<Page<Tag>> {
    const found = await this.page(
      `/snapshots/${snapshotId}/tags`,
      pageQuery(options),
      toTag,
      request,
      [404],
    );
    return found ?? { items: [], total: 0, page: options?.page ?? 1, limit: options?.limit ?? 20 };
  }

  /** Add a tag to a snapshot. */
  async addTagToSnapshot(
    snapshotId: number,
    tagId: number,
    request?: RequestOptions,
  ): Promise<Tag> {
    const raw = await this.json<RawTag>("POST", `/snapshots/${snapshotId}/tags`, {
      body: { tagId },
      signal: request?.signal,
    });
    return toTag(raw);
  }

  /** Remove a tag from a snapshot. Returns true if removed, false if not found. */
  removeTagFromSnapshot(
    snapshotId: number,
    tagId: number,
    request?: RequestOptions,
  ): Promise<boolean> {
    return this.remove(`/snapshots/${snapshotId}/tags/${tagId}`, request);
  }

  // ---------------------------------------------------------------------------
  // Schedules
  // ---------------------------------------------------------------------------

  /** List scheduled archive jobs, oldest first, one page at a time. */
  listSchedules(options?: PageOptions, request?: RequestOptions): Promise<Page<Schedule>> {
    return this.pageOf("/schedules", options, (s: Schedule) => s, request);
  }

  /** Iterate over every schedule, fetching pages lazily. */
  iterateSchedules(options: IterateOptions = {}): AsyncGenerator<Schedule> {
    return this.pages(
      (page, limit, request) => this.listSchedules({ page, limit }, request),
      options,
    );
  }

  /** Create a new scheduled archive job. Throws WebFrostError (code VALIDATION) on a bad url or cron. */
  createSchedule(url: string, cron: string, request?: RequestOptions): Promise<Schedule> {
    return this.json("POST", "/schedules", { body: { url, cron }, signal: request?.signal });
  }

  /** Update a schedule (e.g. pause/resume). Returns the updated schedule. */
  updateSchedule(
    id: number,
    update: { paused: boolean },
    request?: RequestOptions,
  ): Promise<Schedule> {
    return this.json("PATCH", `/schedules/${id}`, { body: update, signal: request?.signal });
  }

  /** Delete a schedule by id. Returns true if deleted, false if not found. */
  deleteSchedule(id: number, request?: RequestOptions): Promise<boolean> {
    return this.remove(`/schedules/${id}`, request);
  }

  // ---------------------------------------------------------------------------
  // Server, stats and keys
  // ---------------------------------------------------------------------------

  /** Get dashboard stats: snapshot count, storage usage, success rate, schedule count, failed today. */
  getStats(request?: RequestOptions): Promise<DashboardStats> {
    return this.json("GET", "/stats", { signal: request?.signal });
  }

  /** Get server info: version, storage path, and total snapshot count. */
  getServerInfo(request?: RequestOptions): Promise<ServerInfo> {
    return this.json("GET", "/settings/info", { signal: request?.signal });
  }

  /** List active (non-revoked) API keys, oldest first, one page at a time. */
  listApiKeys(options?: PageOptions, request?: RequestOptions): Promise<Page<ApiKey>> {
    return this.pageOf("/settings/keys", options, (k: ApiKey) => k, request);
  }

  /** Iterate over every active API key, fetching pages lazily. */
  iterateApiKeys(options: IterateOptions = {}): AsyncGenerator<ApiKey> {
    return this.pages(
      (page, limit, request) => this.listApiKeys({ page, limit }, request),
      options,
    );
  }

  /**
   * Create a new API key, optionally expiring at `expiresAt`. The raw key is returned once and
   * never stored.
   */
  createApiKey(name: string, options?: CreateApiKeyOptions): Promise<ApiKeyCreated> {
    const expiresAt =
      options?.expiresAt instanceof Date ? options.expiresAt.toISOString() : options?.expiresAt;
    return this.json("POST", "/settings/keys", {
      body: expiresAt !== undefined ? { name, expiresAt } : { name },
      signal: options?.signal,
    });
  }

  /** Revoke an API key by id. Returns true if revoked, false if not found. */
  revokeApiKey(id: string, request?: RequestOptions): Promise<boolean> {
    return this.remove(`/settings/keys/${encodeURIComponent(id)}`, request);
  }

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------

  /**
   * Import URLs from a feed URL or raw content.
   * Returns counts of queued and skipped URLs plus the detected format.
   */
  importUrls(options: ImportOptions, request?: RequestOptions): Promise<ImportResult> {
    return this.json("POST", "/import", { body: options, signal: request?.signal });
  }

  /**
   * Import URLs from a file (OPML, Netscape bookmarks, RSS or plain text) uploaded as multipart
   * form data. The format is auto-detected from the file name and content unless `format` is
   * given. A bare `Blob` has no name, so pass `filename` (e.g. "bookmarks.html") to help detection.
   */
  importFile(
    file: Blob,
    format?: ImportFormat,
    request?: RequestOptions & { filename?: string },
  ): Promise<ImportResult> {
    const form = new FormData();
    const name = request?.filename ?? (file as { name?: string }).name ?? "import.txt";
    form.append("file", file, name);
    if (format) form.append("format", format);
    return this.json("POST", "/import/file", { body: form, signal: request?.signal });
  }

  /** List past imports, newest first, one page at a time. */
  listImports(options?: PageOptions, request?: RequestOptions): Promise<Page<ImportRecord>> {
    return this.pageOf("/imports", options, (r: ImportRecord) => r, request);
  }

  /** Iterate over the whole import history, fetching pages lazily. */
  iterateImports(options: IterateOptions = {}): AsyncGenerator<ImportRecord> {
    return this.pages(
      (page, limit, request) => this.listImports({ page, limit }, request),
      options,
    );
  }
}
