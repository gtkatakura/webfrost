# WebFrost — Agent Guide

## Project Overview

WebFrost is a self-hosted web archiving toolkit. It archives URLs into multiple formats (WARC, PDF, screenshot, readability, DOM snapshot, SingleFile, media via yt-dlp) using a shared HTTP cache and single browser navigation per snapshot. Data is stored in open formats (files + SQLite).

## Architecture

Bun monorepo with 5 packages:

| Package | Purpose |
|---------|---------|
| `packages/core` | Extractors, pipeline, DB (SQLite), FTS, scheduler |
| `packages/server` | Elysia HTTP API, serves static UI from `./public` |
| `packages/sdk` | TypeScript client for the REST API |
| `packages/cli` | CLI interface (`webfrost add`, `list`, `search`, etc.) |
| `packages/ui` | React + Vite + Tailwind v4 web interface |

## Tech Stack

- **Runtime:** Bun
- **Database:** SQLite via `bun:sqlite` (schema applied inline, no migration tool)
- **Server:** Elysia
- **UI:** React, Vite, Tailwind CSS v4, TanStack Virtual, Sonner (toasts)
- **Testing:** Bun test (unit), Playwright (E2E, Chromium only)
- **Lint/Format:** Biome
- **Git hooks:** Lefthook (pre-commit: lint + typecheck)
- **Benchmarks:** mitata (micro), Playwright (page-load), vs-ArchiveBox (Docker comparative)
- **CI:** GitHub Actions
- **Release:** Changesets

## Common Commands

```bash
bun install                          # Install dependencies
bun run build                        # Build all packages
bun run lint                         # Lint (biome check)
bun run format                       # Auto-format (biome)
bun run typecheck                    # Type-check (tsc)
bun run test                         # Unit tests (all packages)
bun run bench                        # Full benchmark suite

# Dev servers (two terminals)
cd packages/server && AUTH_DISABLED=true bun run start
cd packages/ui && bun run dev

# E2E tests
cd packages/ui && bunx playwright test

# Docker
docker compose -f docker-compose.prod.yml up -d
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `WEBFROST_DIR` | Data directory (DB + archives) |
| `SESSION_SECRET` | Session signing key (required for auth) |
| `AUTH_DISABLED` | Set `true` for dev/test to skip auth |
| `PORT` | HTTP port (default 3000) |
| `WEBFROST_LOG_LEVEL` | `debug \| info \| warn \| error` |

## Agent Roles

| Agent | Responsibilities |
|-------|-----------------|
| CEO | Strategic decisions, hiring, resource allocation, cross-team coordination |
| Product Owner | Specs, acceptance criteria, task scoping and routing |
| Engineer | Backend features, API, pipeline, CLI, core logic, Makefile/DX |
| Frontend Engineer | UI features, React components, Vite config, Tailwind |
| QA Engineer | Test verification, bug reproduction, E2E test authoring |
| DevOps | CI/CD, Docker, GitHub Actions, infrastructure |
| Technical Writer | README, ROADMAP, docs accuracy |

## Key Files

- `CLAUDE.md` — Git workflow, handoff protocol, agent IDs, documentation rules
- `README.md` — User-facing docs (must stay current)
- `ROADMAP.md` — Feature status tracking (must stay current)
- `.github/workflows/ci.yml` — CI pipeline (lint, typecheck, test, e2e, bench)
- `lefthook.yml` — Pre-commit hooks config
- `.env.example` — All environment variables
