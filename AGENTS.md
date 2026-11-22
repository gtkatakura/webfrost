# WebFrost: guide for coding agents

WebFrost is a self-hosted web archiving toolkit. It archives a URL to WARC, PDF, a full-page screenshot, readable text, a DOM snapshot, a self-contained HTML file and media (yt-dlp), from one HTTP fetch and one browser navigation. Data is plain files plus SQLite (or an S3-compatible bucket).

Humans: [CONTRIBUTING.md](CONTRIBUTING.md) is the same material in more detail.

## Layout

Bun monorepo, tools and tasks in `mise.toml` (`mise tasks` lists them).

| Path | What it is |
|---|---|
| `packages/core` | Database (`bun:sqlite`, schema applied inline), pipeline, extractors, job runner, scheduler, storage, auth primitives, SSRF guard |
| `packages/cli` | The `webfrost` command, a thin layer over core |
| `packages/server` | HTTP API (Elysia); serves the UI build |
| `packages/sdk` | Typed HTTP client, no dependency on core |
| `packages/ui` | React + Vite + Tailwind 4 single-page app; talks to the server only through the SDK |
| `apps/docs` | The docs site (webfrost.dev): React Router, Fumadocs, MDX in `content/docs` |
| `bench/` | Benchmarks, including a comparison with ArchiveBox |

## Commands

```bash
mise install && mise run setup   # pinned Bun, dependencies, Playwright's Chromium
mise run dev                     # API on :3000 (auth disabled) + UI on :5173
bun run lint                     # Biome
bun run typecheck                # tsc for the packages and the docs site
bun run test                     # unit and integration tests
mise run test:e2e                # Playwright against the built UI
mise run docs:dev                # docs site on :5174
```

If Chromium is already installed, set `WEBFROST_CHROMIUM_PATH=/usr/bin/chromium` instead of downloading Playwright's.

## Rules

- **Tests:** a change comes with a test that fails without it. Assert on the final state (snapshot status, files on disk), not only on the HTTP response.
- **Docs:** a user-facing change updates, in the same change, everything that describes it. Go down this list:
  - `apps/docs/content/docs`: the reference page (CLI, REST API, SDK, configuration, extractors, web UI) and any guide or architecture page that tells the old story (`grep` for the old behaviour).
  - New API route or environment variable: its row in `reference/rest-api.mdx` or `reference/configuration.mdx`. `packages/server/src/docs-coverage.test.ts` fails without it.
  - Visible UI change: retake the screenshots (`mise run docs:screens -- <base-url> <snapshot-id>` against an archive of real pages, never test pages or copyrighted media) (it writes the README's `.github/assets/screenshot-*.webp` too).
  - `README.md`: when the quickstart, the install options or the big picture change.
  - `ROADMAP.md`: a shipped item moves to "Already there"; a new idea goes to "Next".
  - `skills/`: when the CLI, API or SDK usage it teaches changes.
  - A changeset (below), and `CHANGELOG.md` only at release time.
- **Changesets:** anything users will notice gets one (`bun changeset`).
- **Hooks:** Lefthook runs lint and typecheck before each commit. Fix what they report; never `--no-verify`.
- **Security:** every outbound request goes through the SSRF guard (`safeFetch`, `guardBrowserContext` in `packages/core`). Read `apps/docs/content/docs/architecture/security.mdx` before touching auth, fetching or the browser.
- **Git:** never force-push `main`. Stage only the files you changed.
