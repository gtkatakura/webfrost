---
"@webfrost/core": patch
"@webfrost/cli": patch
---

Archive fidelity, real cancellation and yt-dlp hardening.

**Fixed**

- WARC files were invalid for compressed, binary and non-UTF-8 responses: the body was the runtime's decoded text while the headers still said `Content-Encoding: gzip` and the original `Content-Length`. The response record now holds the body exactly as the server sent it (still compressed, bytes untouched), `Transfer-Encoding` is dropped and `Content-Length` matches the stored body. Records carry `WARC-Block-Digest` / `WARC-Payload-Digest` and pass `warcio check`.
- The WARC targets the final URL after redirects; each redirect gets its own `response` record and a `metadata` record keeps the URL that was requested.
- HTML and Readability decode the page with its declared charset (`Content-Type`, then `<meta charset>`), so latin1 and other non-UTF-8 pages are no longer mojibake. Readability resolves links against the final URL. A URL that is not text (PDF, image) no longer produces garbage `html` / `readability` results.
- Timeouts now cancel the work: a timed-out extractor's downloads are aborted, and yt-dlp runs in its own process group that is killed as a whole (no orphaned ffmpeg). Nothing is recorded after a timeout.
- SingleFile: CSS containing `$'` or `$&` was corrupted and only the first of repeated tags was inlined.
- Bulk import: `&amp;` and other entities in feed, OPML and bookmark URLs are decoded; relative Atom links are resolved against the feed URL (or `xml:base`, or the feed's `rel="self"` link).

**Security**

- yt-dlp is called with `--ignore-config`, `--no-playlist --playlist-items 1`, `--use-extractors default,-generic` and `--` before the URL. The separate `--simulate` probe is gone (one `--dump-json` call).

**Added**

- `WEBFROST_SINGLEFILE_MAX_BYTES` (100 MB) and `WEBFROST_SINGLEFILE_CONCURRENCY` (8) bound what SingleFile downloads; assets over the budget stay remote.
- `WEBFROST_READABILITY_MAX_BYTES` (10 MB): Readability parses at most that much of a page.
- `safeFetch(url, { signal })`, `fetchGuarded()` (redirect chain, raw body) and `runProcess(cmd, { signal, processGroup })` in `@webfrost/core`; `parseUrls(content, format, baseUrl)`.
