# Stage 1 — build the React UI
ARG BUN_VERSION=1.4.4
FROM oven/bun:${BUN_VERSION} AS ui-builder
WORKDIR /app

# Copy all workspace manifests so bun can resolve the full lockfile
COPY package.json bun.lock ./
COPY packages/cli/package.json packages/cli/
COPY packages/core/package.json packages/core/
COPY packages/sdk/package.json packages/sdk/
COPY packages/server/package.json packages/server/
COPY packages/ui/package.json packages/ui/

# Install deps (skip prepare/lefthook which requires git)
RUN bun install --frozen-lockfile --ignore-scripts

# Copy SDK + UI source; build SDK first (Vite needs the compiled JS, not TS source)
COPY packages/sdk/ packages/sdk/
COPY packages/ui/ packages/ui/
RUN bun run --filter '@webfrost/sdk' build
RUN bun run --filter '@webfrost/ui' build

# Stage 2 — build the Elysia server
FROM oven/bun:${BUN_VERSION} AS server-builder
WORKDIR /app

# Copy all workspace manifests so bun can resolve the full lockfile
COPY package.json bun.lock ./
COPY packages/cli/package.json packages/cli/
COPY packages/core/package.json packages/core/
COPY packages/sdk/package.json packages/sdk/
COPY packages/server/package.json packages/server/
COPY packages/ui/package.json packages/ui/

# Install deps (skip prepare/lefthook which requires git)
RUN bun install --frozen-lockfile --ignore-scripts

# Copy source and build
COPY packages/core/ packages/core/
COPY packages/server/ packages/server/
RUN bun run --filter '@webfrost/core' build
RUN bun run --filter '@webfrost/server' build

# Hoist workspace-local deps to root node_modules so the runtime image can
# resolve them from dist/index.js. bun installs jsdom/playwright under
# packages/core/node_modules (not root) because they are not root deps.
RUN ln -sf "$(readlink -f packages/core/node_modules/jsdom)" node_modules/jsdom && \
    mkdir -p node_modules/@mozilla && \
    ln -sf "$(readlink -f packages/core/node_modules/@mozilla/readability)" node_modules/@mozilla/readability

# Stage 3 — runtime image
FROM oven/bun:${BUN_VERSION}-slim
WORKDIR /app

# yt-dlp release to install: "latest" or a tag such as 2025.01.15
ARG YTDLP_VERSION=latest
ARG TARGETARCH

# External deps (jsdom reads CSS from disk via __dirname at load time;
# playwright is a runtime optional dep — both must be on disk, not bundled)
COPY --from=server-builder /app/node_modules ./node_modules
# jsdom and playwright are installed as workspace-local deps under packages/core;
# bun symlinks them there (not in root node_modules), so copy the symlink tree too.
COPY --from=server-builder /app/packages/core/node_modules ./packages/core/node_modules

# Runtime tools the extractors shell out to. Without them the server still starts,
# but every snapshot would be limited to HTML, WARC and Readability:
#   - Chromium (headless shell) → PDF, screenshot, DOM snapshot, SingleFile
#   - yt-dlp + ffmpeg           → media extraction
# The Playwright CLI is run with bun because the image has no node binary.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg \
    && bun node_modules/playwright/cli.js install --with-deps --only-shell chromium \
    && case "${TARGETARCH:-amd64}" in \
         arm64) ytdlp_asset=yt-dlp_linux_aarch64 ;; \
         *)     ytdlp_asset=yt-dlp_linux ;; \
       esac \
    && if [ "${YTDLP_VERSION}" = "latest" ]; then \
         ytdlp_url="https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytdlp_asset}"; \
       else \
         ytdlp_url="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/${ytdlp_asset}"; \
       fi \
    && curl -fsSL "${ytdlp_url}" -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

# Server bundle
COPY --from=server-builder /app/packages/server/dist ./dist

# UI static assets served from ./public (fallback path for production)
COPY --from=ui-builder /app/packages/ui/dist ./public

# Archive data (SQLite database + snapshot files). Mount a volume here.
ENV WEBFROST_DIR=/data
RUN mkdir -p /data
VOLUME /data

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "run", "dist/index.js"]
