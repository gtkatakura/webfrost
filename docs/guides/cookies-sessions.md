---
title: Cookies and sessions
description: Archiving pages that require authentication or session cookies.
---

# Cookies and sessions

Some pages require you to be logged in to view their full content.

::: warning
WebFrost does not currently support archiving authenticated pages. There is no cookie file option in the CLI, server, or SDK, and the pipeline fetches and renders every page as an anonymous visitor. The archive of a login-protected page will contain what an anonymous visitor sees (usually the login page).
:::

## What is not supported

- Passing a cookies file (for example in Netscape format) to the pipeline.
- Reusing a browser profile with an existing login session. The pipeline launches a fresh headless Chromium context per snapshot (set `WEBFROST_CHROMIUM_PATH` only to change which Chromium binary is used, not its profile).

If the content is also available at a public URL, archive that one. Otherwise save the page
yourself with a browser extension such as SingleFile; WebFrost cannot ingest such a file yet.
Cookie and browser-profile support is tracked in the [roadmap](../../ROADMAP.md).
