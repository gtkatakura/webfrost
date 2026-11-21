/**
 * FetchCache — a per-pipeline-run in-memory cache for HTTP responses.
 *
 * Ensures that all extractors within a single pipeline.run() call share one
 * HTTP response per URL, preventing duplicate network requests.
 */

import { decodeContentEncoding, decodeText, isTextualContentType } from "./http-body";
import { type FetchedResponse, fetchGuarded } from "./ssrf-guard";

export interface CachedResponse {
  /**
   * The body decoded to text (Content-Encoding undone, charset from Content-Type or
   * `<meta charset>`). Empty for non-text responses such as PDFs and images.
   */
  html: string;
  headers: Headers;
  status: number;
  statusText: string;
  /** The URL that answered, after redirects. */
  url: string;
  /** The URL that was asked for. */
  requestedUrl: string;
  /** The body exactly as received: still in its Content-Encoding, chunked framing removed. */
  body: Uint8Array<ArrayBuffer>;
  /** Redirect responses that led to `url`, in order. */
  redirects: FetchedResponse[];
  /** Whether the body is text (HTML, XML, plain text...) rather than a binary format. */
  isText: boolean;
}

export class FetchCache {
  private readonly _cache = new Map<string, Promise<CachedResponse>>();

  /**
   * Return the cached response for `url`, fetching it exactly once.
   * Throws if the request itself fails; HTTP error statuses are returned as is.
   */
  get(url: string): Promise<CachedResponse> {
    if (!this._cache.has(url)) {
      this._cache.set(url, this._fetchOnce(url));
    }
    // biome-ignore lint/style/noNonNullAssertion: set above
    return this._cache.get(url)!;
  }

  private async _fetchOnce(url: string): Promise<CachedResponse> {
    // Keep the body as it came over the wire: the WARC must store what the server
    // sent, consistent with its Content-Encoding header. Text is decoded here.
    const result = await fetchGuarded(url, { decompress: false });
    const contentType = result.headers.get("content-type");
    const isText = isTextualContentType(contentType);
    let html = "";
    if (isText) {
      let decoded: Uint8Array;
      try {
        decoded = decodeContentEncoding(result.body, result.headers.get("content-encoding"));
      } catch {
        // Unknown coding or a server that mislabels its body: use the bytes as they are.
        decoded = result.body;
      }
      html = decodeText(decoded, contentType);
    }
    return {
      html,
      headers: result.headers,
      status: result.status,
      statusText: result.statusText,
      url: result.url,
      requestedUrl: result.requestedUrl,
      body: result.body,
      redirects: result.redirects,
      isText,
    };
  }

  /** Number of unique URLs currently cached. */
  get size(): number {
    return this._cache.size;
  }
}
