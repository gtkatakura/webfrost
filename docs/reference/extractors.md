# Reference: Extractors

WebFrost runs multiple extractors for each snapshot. All extractors run in parallel after a single browser navigation, sharing one HTTP cache.

---

## Extractor list

| Name | Output | Requires | Description |
|---|---|---|---|
| `warc` | `.warc` | — | Raw HTTP archive (Web ARChive format). Captures all HTTP request/response pairs including headers, status codes, and bodies. |
| `readability` | `.json` | — | Article text extracted using the Mozilla Readability algorithm. Returns title, byline, content (HTML), and plain text. |
| `pdf` | `.pdf` | Chromium | Full-page PDF rendered by the headless browser. |
| `screenshot` | `.png` | Chromium | Full-page PNG screenshot. |
| `dom-snapshot` | `.json` | Chromium | Serialized DOM tree at capture time. |
| `singlefile` | `.html` | Chromium | Self-contained HTML file with all assets (CSS, images, fonts) inlined as data URIs. Playable offline. |
| `html` | `.html` | — | Raw HTML source (response body). |
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

If Chromium is not available, those four extractors are skipped and the snapshot still completes with the remaining extractors.

---

## yt-dlp dependency

Media extraction (`media`, `media-metadata`) requires [yt-dlp](https://github.com/yt-dlp/yt-dlp):

```bash
# macOS
brew install yt-dlp

# pip
pip install yt-dlp
```

If yt-dlp is not installed, media extraction is silently skipped — the snapshot completes with all other extractors.

---

## Download an archive file

Via CLI:

```bash
# Files are stored in WEBFROST_DIR — find them by snapshot ID
ls ./data/<snapshot-id>/
```

Via REST API:

```bash
curl -O -J \
  http://localhost:3000/api/snapshots/<id>/archives/<extractor>/download \
  -H "Authorization: Bearer wf_your_api_key_here"
```

Available extractor names for the download route: `warc`, `pdf`, `screenshot`, `readability`, `dom-snapshot`, `singlefile`, `html`, `media`, `media-metadata`.
