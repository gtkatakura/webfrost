# WebFrost — developer workflow Makefile
#
# Run `make` or `make help` to list all targets.
# Each target documents itself with a trailing ## comment.

.PHONY: help setup install dev build test test-e2e lint format typecheck ci \
        bench bench-vs-archivebox bench-up bench-down bench-chart \
        act docker-up docker-down clean \
        docs-dev docs-build docs-preview docs-install

## ─── Discovery ────────────────────────────────────────────────────────────────

help: ## Show this help
	@printf '\033[1mWebFrost — available targets\033[0m\n\n'
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2}'
	@printf '\n'

## ─── Bootstrap ────────────────────────────────────────────────────────────────

setup: ## Bootstrap a fresh clone: install deps + Playwright browsers
	bun install
	bunx playwright install --with-deps chromium

install: ## Install Node/Bun dependencies only
	bun install

## ─── Development ──────────────────────────────────────────────────────────────

dev: ## Start API server + Vite UI dev server concurrently (Ctrl+C stops both)
	@printf '\033[1mStarting dev stack\033[0m (API :3000 · UI :5173) — Ctrl+C to stop\n'
	@mkdir -p ./data
	@trap 'kill 0' INT; \
	  (WEBFROST_DIR=./data AUTH_DISABLED=true bun run packages/server/src/index.ts) & \
	  (cd packages/ui && bun run dev) & \
	  wait

## ─── Docs ─────────────────────────────────────────────────────────────────────

docs-install: ## Install docs dependencies (part of the workspace)
	bun install

docs-dev: ## Start the docs site (apps/docs) with hot reload (http://localhost:5174/)
	bun run docs:dev

docs-build: ## Prerender the docs site to apps/docs/build/client
	bun run docs:build

docs-preview: ## Serve the built docs site (http://localhost:5175/)
	bun run docs:preview

## ─── Build ────────────────────────────────────────────────────────────────────

build: ## Build all packages and the docs site
	bun run build

## ─── Quality ──────────────────────────────────────────────────────────────────

lint: ## Run Biome linter across the monorepo
	bun run lint

format: ## Auto-format all source files with Biome
	bun run format

typecheck: ## TypeScript type-check (no emit)
	bun run typecheck

## ─── Tests ────────────────────────────────────────────────────────────────────

test: ## Run unit tests across all packages (bun test)
	bun run test

test-e2e: ## Run Playwright E2E tests (requires Chromium + yt-dlp)
	cd packages/ui && bunx playwright test

## ─── CI ───────────────────────────────────────────────────────────────────────

ci: lint typecheck test ## Run the same checks as CI (lint + typecheck + unit tests)

act: ## Simulate the CI pipeline locally via nektos/act
	act -W .github/workflows/ci.yml

## ─── Benchmarks ───────────────────────────────────────────────────────────────

bench: ## Run internal microbenchmarks (extractors, cache, navigation, page-load)
	bun run bench

bench-vs-archivebox: bench-up ## Run head-to-head comparison (starts + stops Docker services)
	bun bench/vs-archivebox/run.ts
	$(MAKE) bench-chart
	$(MAKE) bench-down

bench-up: ## Start benchmark Docker services (fixtures + WebFrost + ArchiveBox)
	docker compose -f bench/vs-archivebox/docker-compose.yml up -d --wait

bench-down: ## Stop and remove benchmark Docker services and volumes
	docker compose -f bench/vs-archivebox/docker-compose.yml down -v

bench-chart: ## Generate HTML chart report from bench/vs-archivebox/results/latest.json
	bun bench/vs-archivebox/chart.ts

## ─── Docker (production) ──────────────────────────────────────────────────────

docker-up: ## Start the production Docker stack (docker-compose.prod.yml)
	docker compose -f docker-compose.prod.yml up -d

docker-down: ## Stop and remove the production Docker stack
	docker compose -f docker-compose.prod.yml down

## ─── Housekeeping ─────────────────────────────────────────────────────────────

clean: ## Remove all build artifacts (dist/ directories across packages)
	find packages -name dist -type d -exec rm -rf {} + 2>/dev/null || true
