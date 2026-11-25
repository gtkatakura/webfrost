---
"@webfrost/core": patch
---

yt-dlp's requests now go through the SSRF egress proxy, like the browser's: a media page can no longer make yt-dlp fetch a private address (cloud metadata, a service on the server), whatever a site's extractor follows. The Mediasite extractors, which accept any host, are no longer used. If the proxy cannot start, media extraction is skipped rather than run unguarded.
