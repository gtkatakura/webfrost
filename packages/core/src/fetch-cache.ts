/**
 * FetchCache — a per-pipeline-run in-memory cache for HTTP responses.
 *
 * Ensures that all extractors within a single pipeline.run() call share one
 * HTTP response per URL, preventing duplicate network requests.
 */

export interface CachedResponse {
  html: string;
  headers: Headers;
  status: number;
  statusText: string;
}

export class FetchCache {
  private readonly _cache = new Map<string, Promise<CachedResponse>>();

  /**
   * Return the cached response for `url`, fetching it exactly once.
   * Throws if the HTTP response is not ok (status >= 400).
   */
  get(url: string): Promise<CachedResponse> {
    if (!this._cache.has(url)) {
      this._cache.set(url, this._fetchOnce(url));
    }
    // biome-ignore lint/style/noNonNullAssertion: set above
    return this._cache.get(url)!;
  }

  private async _fetchOnce(url: string): Promise<CachedResponse> {
    const response = await fetch(url);
    const html = await response.text();
    return {
      html,
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    };
  }

  /** Number of unique URLs currently cached. */
  get size(): number {
    return this._cache.size;
  }
}
