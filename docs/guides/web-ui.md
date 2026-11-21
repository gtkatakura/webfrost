---
title: Web UI
description: Using the WebFrost web interface — browsing, searching, and managing snapshots.
---

# Web UI

The `@webfrost/server` package serves a React single-page app alongside the REST API at `http://localhost:3000`.

## Start the server

**From source:**

```bash
bun run build   # Build UI assets (required once)
export SESSION_SECRET=$(openssl rand -hex 32)
WEBFROST_DIR=./data SESSION_SECRET=$SESSION_SECRET bun run packages/server/src/index.ts
```

**With Docker:**

See [Docker setup](/getting-started/docker).

## First-run setup

On first visit, WebFrost shows a setup wizard to create your admin account (a username and a password of at least 8 characters). After that, log in with your username and password.

::: warning Logging in over plain HTTP
The session cookie is `Secure`, so browsers drop it on plain-HTTP origins other than `localhost`. If login bounces back to the login page on a LAN address, serve WebFrost over TLS or set `WEBFROST_INSECURE_COOKIES=true`.
:::

---

## Pages

### Dashboard

The home screen shows four stat cards (total snapshots, storage used, schedules active, recent snapshots), a **Quick Archive** form to submit a URL, and a **Recent Activity** feed grouped by day.

### Snapshots

A virtualized list of all archived snapshots. Each row shows the URL, capture date, status badge, and any tags.

- **Density toggle** — switch between compact and comfortable row height.
- **Inline filter** — filter by URL text, status, or tags without leaving the list.
- **Bulk selection** — check rows to select multiple snapshots, then delete them using the floating action bar.
- **Detail panel** — click any row to open the snapshot detail in a slide-over panel (URL param `?id=…`).

### Snapshot Detail

Full-page view of a single snapshot. Shows extractor results with file sizes and download links: WARC, PDF, PNG, Readability JSON, DOM snapshot, SingleFile HTML, and media. Tags can be added and removed from this view.

### Search

Full-text search over the SQLite FTS5 index. The sidebar allows filtering by status, tags, and saved searches (stored in `localStorage`). Results show matched snippets with keyword highlighting. You can bookmark/save a search for later access.

### Tags

Create and delete tags. Each tag has a name and a hex color that appears as a chip on snapshot rows and detail views.

### Schedules

Create schedules with cron expressions or human-readable presets. Each schedule row shows:

- Health badge: **On schedule**, **Overdue**, **Paused**, or **Never run**
- Last-run status and consecutive failure count
- **Next 5 runs** — expandable preview of upcoming trigger times

Schedules can be paused, resumed, and deleted (with a confirmation step).

### Import

Submit a bulk import from format selection cards:

| Format | Input |
|--------|-------|
| RSS feed | URL |
| OPML | File upload |
| Netscape bookmarks | File upload (.html) |
| Plain text | One URL per line |

After import, a result summary shows total URLs found and how many were queued. The import history is shown in a tabbed view alongside the import form.

### Settings

- Toggle light/dark theme
- Change your account password (all other sessions are signed out)
- View server info (version, storage path)

### API Keys

Create and revoke API keys for use with the REST API and SDK. Keys are shown once on creation — copy them to a safe place.

---

## Read-only guest view

Start the server with `WEBFROST_PUBLIC_READ=true` to let people browse the archive without an
account. Guests get the Dashboard, Snapshots, Search and Tags pages, can open any snapshot and
download or preview its files, and see a small **Read-only** marker with a **Sign in** link in
the sidebar. Everything that changes the archive — archiving, deleting, tagging, importing,
schedules, settings, API keys — only appears after signing in. Opening one of those pages as a
guest leads to the login screen and back to the page afterwards.

## Navigation

The collapsible sidebar has two sections:

**Primary:** Dashboard, Snapshots, Schedules, Tags

**Secondary:** Import, Settings

The sidebar width collapses from 240 px to 56 px (icon-only). The state is saved to `localStorage` and restored on reload.

On mobile, the sidebar becomes a drawer opened by the hamburger menu in the top bar.

---

## Keyboard shortcuts

| Keys | Action |
|------|--------|
| `⌘K` / `Ctrl+K` | Open search palette |
| `?` | Show keyboard shortcuts modal |
| `g` then `h` | Go to Dashboard |
| `g` then `s` | Go to Snapshots |
| `g` then `t` | Go to Tags |
| `g` then `i` | Go to Import |

`g` sequences time out after 1 second if the second key is not pressed. Shortcuts are disabled when focus is in an input, textarea, or select.

---

## Search palette

Press `⌘K` (or `Ctrl+K`) to open the command palette. Type to search snapshots by URL or title. Use `↑`/`↓` to move between results and `Enter` to navigate to the selected snapshot. Press `Escape` to close.

---

## Theme system

The UI supports **light** and **dark** modes. Toggle the theme using the sun/moon icon in the sidebar footer.

- Theme is persisted to `localStorage` (`webfrost-theme`).
- On first visit, the theme follows the system preference (`prefers-color-scheme`).
- All colors are defined as CSS custom properties on `:root` and overridden on `.dark`, using a Zinc + Violet palette.

| CSS variable | Light | Dark |
|---|---|---|
| `--bg-app` | `zinc-50` | `zinc-950` |
| `--bg-surface` | `white` | `zinc-900` |
| `--accent` | `violet-600` | `violet-500` |
| `--text-high` | `zinc-900` | `zinc-50` |
| `--text-mid` | `zinc-500` | `zinc-400` |
