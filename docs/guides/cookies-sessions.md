---
title: Cookies and sessions
description: Archiving pages that require authentication or session cookies.
---

# Cookies and sessions

Some pages require you to be logged in to view their full content. WebFrost uses Playwright (Chromium) for browser-based extractors, which means you can pass a cookies file to archive authenticated pages.

::: warning
Archiving authenticated pages requires sharing session cookies with WebFrost. Use a dedicated account with minimal permissions. Never use your primary account credentials.
:::

## How it works

For extractors that use the browser (PDF, screenshot, DOM snapshot, SingleFile), Playwright can load cookies before navigating to the URL. For WARC, Readability, and HTML extractors that use the fetch cache, cookies are passed as request headers.

## Exporting cookies

Use a browser extension to export cookies in Netscape format:

- **Chrome/Firefox:** [EditThisCookie](https://www.editthiscookie.com/) or [Cookie-Editor](https://cookie-editor.com/)
- **Firefox:** `about:debugging` → export cookies manually

Save the file as `cookies.txt` in Netscape format:

```
# Netscape HTTP Cookie File
.example.com	TRUE	/	FALSE	0	session_id	abc123xyz
```

## Passing cookies (coming soon)

Cookie support via `--cookies <file>` is on the roadmap. Until it ships, you can work around this by running WebFrost in a browser profile that already has the session:

1. Launch Chromium with a persistent profile:
   ```bash
   chromium --user-data-dir=/path/to/profile
   ```
2. Log in to the target site in that profile.
3. Configure WebFrost to use that profile (via `PLAYWRIGHT_CHROME_USER_DATA_DIR` — check `@webfrost/core` for the current env var name).

## Public-facing snapshots

For pages behind a paywall or login that you legitimately have access to, archiving for personal preservation is generally acceptable. Do not share authenticated snapshots publicly.
