# Product

<!-- impeccable:product-schema 1 -->

<!-- Inferred from README.md, apps/docs/content/docs and the code; not yet confirmed in an interview. -->

## Platform

web

## Users

- **The owner of an archive**: one admin who runs WebFrost on their own machine or server and uses the web UI to archive pages, check that archiving worked, find something they saved and manage schedules, feeds, tags and API keys. Often switches between the UI, the `webfrost` CLI and scripts.
- **Guests of a public, read-only archive** (`WEBFROST_PUBLIC_READ=true`): browse, search and read snapshots; cannot change anything.

## Product Purpose

WebFrost keeps the web pages people care about, on their own machine. One fetch and one browser navigation produce every format worth keeping (WARC, HTML, readable text, PDF, full-page screenshot, DOM snapshot, a self-contained HTML file and, for media pages, the video), and everything saved is searchable. Success in the UI: a URL goes in, the user sees it captured (or why it was not), and can find and read it again later.

## Positioning

Self-hosted, plain files plus SQLite (or an S3-compatible bucket), no lock-in; one server process with the API, the web UI and the scheduler; safe to put on a network (SSRF guard, sessions, rate limits, read-only public mode).

## Operating Context

- The UI is served by `@webfrost/server` next to the REST API and talks to it only through `@webfrost/sdk`: it can do what an API key can do, no more.
- Routes live after `#` (HashRouter) so links survive any reverse proxy.
- Used at a desk (wide screens, keyboard: `Ctrl/Cmd K` search, `?` shortcuts) and occasionally on a phone to check status or archive a link.

## Capabilities and Constraints

- Pages: Dashboard, Snapshots (list plus a detail panel at `/snapshots/:id`), Search (SQLite FTS5 snippets), Tags, Schedules (cron), Import (RSS/Atom, OPML, bookmarks HTML, plain text), Settings, API keys, Setup, Login.
- Extractors: `warc`, `html`, `readability`, `pdf`, `screenshot`, `dom-snapshot`, `singlefile`, `media`, `media-metadata`.
- Archived HTML is untrusted: previews are framed with `sandbox=""` and must stay that way.
- Terminology: snapshot, extractor, schedule, tag, import, archive.

## Brand Commitments

- Name **WebFrost**; the mark is a snowflake inside a hexagon stroked in the Frost gradient; the wordmark is "Web" in the text colour and "Frost" in the gradient.
- Mascot: an arctic fox asleep on a frozen archive box, used for "nothing archived yet" moments.
- The "Ice Blue" palette is shared with the docs site (webfrost.dev, `apps/docs/app/app.css`).
- Voice: plain, direct, sentence-level honesty about state ("Could not load…", "Retry").

## Evidence on Hand

- Product screenshots used by the docs: `apps/docs/src/assets/screens/`.
- Banner and README screenshots: `.github/assets/`.
- No testimonials, customers or benchmarks are to be invented; the ArchiveBox comparison lives in `bench/`.

## Product Principles

1. State is never ambiguous: loading, empty and failed look different, and failures say why.
2. The archive is the user's: nothing in the UI hides where files are or what was captured.
3. The UI is a client of the public API, never a back door.
4. Read-only guests see the same archive without write controls.

## Accessibility & Inclusion

WCAG 2.2 AA: text contrast 4.5:1 in both themes, visible keyboard focus, real links and buttons, `prefers-reduced-motion` honoured.
