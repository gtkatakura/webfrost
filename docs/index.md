---
layout: home
title: WebFrost
description: Self-hosted web archiving toolkit. One command, six formats, no lock-in.

hero:
  name: WebFrost
  text: Self-hosted web archiving
  tagline: One shared HTTP cache. One browser navigation per snapshot. Durable open formats. No lock-in.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started/quickstart
    - theme: alt
      text: View on GitHub
      link: https://github.com/gtkatakura/webfrost

features:
  - title: Fast by design
    details: One browser navigation per snapshot. All extractors run in parallel with a shared HTTP cache — no duplicate requests, no wasted round trips.
  - title: Six formats per snapshot
    details: WARC, Readability JSON, PDF, full-page screenshot, DOM snapshot, and self-contained HTML — all from a single capture.
  - title: Open formats, no lock-in
    details: WARC is a standard archival format. SQLite and plain files are the database. Copy your archive directory anywhere, open it with any tool.
  - title: Self-hosted
    details: Runs on your machine or server. No cloud account, no API keys, no subscription. Your data stays yours.
  - title: CLI + Web UI + API + SDK
    details: Archive from the terminal, browse from the browser, automate with the REST API, or build integrations with the TypeScript SDK.
  - title: Bulk import and scheduling
    details: Import from RSS feeds, OPML, Netscape bookmarks, or plain URL lists. Schedule recurring archives with cron expressions.
---
