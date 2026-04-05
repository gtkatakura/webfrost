---
title: Supported outputs
description: Output formats produced by WebFrost extractors for each snapshot.
---

# Supported outputs

WebFrost runs up to nine extractors per snapshot. All run in parallel after a single browser navigation.

## Output formats

| Extractor | File | Format | Requires | Description |
|---|---|---|---|---|
| `warc` | `response.warc` | WARC 1.1 | — | Raw HTTP archive — all request/response pairs, headers, and bodies. |
| `readability` | `readability.json` | JSON | — | Article title, byline, and body text extracted via Mozilla Readability. |
| `html` | `page.html` | HTML | — | Raw HTML source (response body). |
| `pdf` | `page.pdf` | PDF | Chromium | Full-page PDF rendered by the headless browser. |
| `screenshot` | `screenshot.png` | PNG | Chromium | Full-page screenshot. |
| `dom-snapshot` | `dom-snapshot.json` | JSON | Chromium | Serialized DOM tree at capture time. |
| `singlefile` | `singlefile.html` | HTML | Chromium | Self-contained offline HTML with all assets inlined as data URIs. |
| `media` | varies | varies | yt-dlp | Video or audio file downloaded via yt-dlp. |
| `media-metadata` | `media-metadata.json` | JSON | yt-dlp | Title, uploader, duration, formats, and more from yt-dlp. |

## Optional extractors

- **Chromium extractors** (PDF, screenshot, DOM snapshot, SingleFile) — skipped if Chromium is not installed. The snapshot still completes with the remaining extractors.
- **yt-dlp extractors** (media, media-metadata) — skipped if yt-dlp is not installed or the URL is not a recognized media source.
- **Media file size limit** — files larger than 500 MB are skipped.

## Downloading outputs

**CLI (filesystem):**

```bash
ls ./data/<snapshot-id>/
```

**REST API:**

```bash
curl -O -J \
  http://localhost:3000/api/snapshots/<id>/archives/<extractor>/download \
  -H "Authorization: Bearer wf_your_api_key_here"
```

Available extractor names: `warc`, `pdf`, `screenshot`, `readability`, `dom-snapshot`, `singlefile`, `html`, `media`, `media-metadata`.

## WARC compatibility

`.warc` files are compatible with:
- [ReplayWeb.page](https://replayweb.page/) — in-browser WARC playback
- [Wayback Machine](https://archive.org/help/wayback-import.php) — importable
- [WARC Tools](https://github.com/webrecorder/warcio) — Python library for processing WARCs
