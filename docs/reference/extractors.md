# Reference: Extractors

WebFrost runs multiple extractors for each snapshot. All extractors run in parallel after a single browser navigation, sharing one HTTP cache. Each extractor has a timeout (`WEBFROST_EXTRACTOR_TIMEOUT_MS`, default 60 s; `yt-dlp` runs use `WEBFROST_MEDIA_TIMEOUT_MS`, default 10 min). Every request the browser makes is checked by the SSRF guard (see [Security](/SECURITY)).

---

## Extractor list

| Name | Output | Requires | Description |
|---|---|---|---|
| `warc` | `.warc` | — | Raw HTTP archive (Web ARChive format). Captures all HTTP request/response pairs including headers, status codes, and bodies. |
| `readability` | JSON (in database) | — | Article text extracted using the Mozilla Readability algorithm. Returns title, byline, content (HTML), and plain text. |
| `pdf` | `.pdf` | Chromium | Full-page PDF rendered by the headless browser. |
| `screenshot` | `.png` | Chromium | Full-page PNG screenshot. |
| `dom-snapshot` | `.html` | Chromium | Serialized DOM at capture time. |
| `singlefile` | `.html` | Chromium | Self-contained HTML file with all assets (CSS, images, fonts) inlined as data URIs. Playable offline. |
| `html` | HTML (in database) | — | Raw HTML source (response body). |
| `media` | varies | yt-dlp | Video or audio file downloaded via yt-dlp. Triggered automatically when yt-dlp detects a supported media URL (YouTube, Vimeo, SoundCloud, etc.). Files larger than 500 MB are skipped. |
| `media-metadata` | `.json` | yt-dlp | Metadata JSON from yt-dlp (title, uploader, duration, formats, etc.). |

---

## Chromium dependency

The PDF, screenshot, DOM snapshot, and SingleFile extractors require Chromium. Install it via Playwright:

```bash
bunx playwright install chromium
```

Or via system package manager:

```bash
# macOS
brew install --cask chromium

# Debian/Ubuntu
apt-get install -y chromium-browser
```

If Chromium is not available, navigation fails, or a request violates the SSRF policy, those four extractors are recorded as failed (with an `error`, visible as `status: "failed"` in the API's `extractorMeta`) and the snapshot still finishes `done` with the remaining extractors, as long as at least one produced output. To use an existing Chromium/Chrome binary instead of Playwright's download, set `WEBFROST_CHROMIUM_PATH`. The Docker image already bundles Chromium.

---

## yt-dlp dependency

Media extraction (`media`, `media-metadata`) requires [yt-dlp](https://github.com/yt-dlp/yt-dlp):

```bash
# macOS
brew install yt-dlp

# pip
pip install yt-dlp
```

If yt-dlp is not installed, or the URL is not a media page, media extraction is skipped silently (no failure is recorded) — the snapshot completes with all other extractors. The Docker image bundles `yt-dlp` and `ffmpeg`.

---

## Download an archive file

Via CLI:

```bash
# Files are stored in WEBFROST_DIR — find them by snapshot ID
ls ./data/snapshots/<snapshot-id>/
```

Via REST API:

```bash
curl -O -J \
  http://localhost:3000/api/snapshots/<id>/archives/<extractor>/download \
  -H "Authorization: Bearer wf_your_api_key_here"
```

Available extractor names for the download route: `warc`, `pdf`, `screenshot`, `readability`, `dom-snapshot`, `singlefile`, `html`, `media`, `media-metadata`.
