---
title: Installation
description: All install methods for WebFrost — from source, Docker, or npm.
---

# Installation

## Requirements

| Dependency | Version | Notes |
|---|---|---|
| [Bun](https://bun.sh) | v1.x | JavaScript runtime and package manager |
| Chromium | any recent | Required for PDF, screenshot, DOM snapshot, and SingleFile extractors. Install via `bunx playwright install chromium` or system package manager. |
| yt-dlp | any | Optional. Required for media extraction (YouTube, Vimeo, etc.). |

## From source (recommended for development)

```bash
git clone https://github.com/gtkatakura/webfrost.git
cd webfrost
bun install
```

Run commands via `bun run`:

```bash
WEBFROST_DIR=./data bun run webfrost <command>
```

## Install Chromium

The PDF, screenshot, DOM snapshot, and SingleFile extractors need Chromium. Install it via Playwright (simplest):

```bash
bunx playwright install chromium
```

Or via system package manager:

::: code-group
```bash [macOS]
brew install --cask chromium
```

```bash [Debian/Ubuntu]
apt-get install -y chromium-browser
```

```bash [Alpine]
apk add chromium
```
:::

If Chromium is not available, those extractors are skipped — the snapshot still completes with WARC, Readability, and HTML.

## Install yt-dlp (optional)

Media extraction requires [yt-dlp](https://github.com/yt-dlp/yt-dlp):

::: code-group
```bash [macOS]
brew install yt-dlp
```

```bash [pip]
pip install yt-dlp
```
:::

If yt-dlp is not installed, media extraction is silently skipped.

## Docker

See [Docker setup](/getting-started/docker) for running WebFrost as a persistent server with Docker Compose.

## Verify

```bash
WEBFROST_DIR=./data bun run webfrost --version
WEBFROST_DIR=./data bun run webfrost init
WEBFROST_DIR=./data bun run webfrost add https://example.com
```

A successful archive produces output like:

```
✓ snapshot abc123 — warc, pdf, screenshot, readability, dom-snapshot, singlefile
```
