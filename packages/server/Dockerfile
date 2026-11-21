# WebFrost server image: API, web UI and scheduler. Build from the repo root:
#   docker build -f packages/server/Dockerfile .
#
# Base images are pinned by digest (the digest fixes the bytes, the tag in the comment says which
# version). Keep the Bun version in step with mise.toml.
# oven/bun:1.4.4
ARG BUN_IMAGE=oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d
# oven/bun:1.4.4-slim
ARG BUN_SLIM_IMAGE=oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4

# Stage 1: every workspace's dependencies, installed once and reused by the build stages.
FROM ${BUN_IMAGE} AS deps
WORKDIR /app
# Every workspace manifest, so bun can check the lockfile against the full workspace.
COPY package.json bun.lock tsconfig.json ./
COPY apps/docs/package.json apps/docs/
COPY packages/cli/package.json packages/cli/
COPY packages/core/package.json packages/core/
COPY packages/sdk/package.json packages/sdk/
COPY packages/server/package.json packages/server/
COPY packages/ui/package.json packages/ui/
# --ignore-scripts skips the prepare hook (lefthook needs git).
RUN bun install --frozen-lockfile --ignore-scripts

# Stage 2: the React UI. Vite needs the SDK compiled to JS, so build that first.
FROM deps AS ui-builder
COPY packages/sdk/ packages/sdk/
COPY packages/ui/ packages/ui/
RUN bun run --filter '@webfrost/sdk' build \
    && bun run --filter '@webfrost/ui' build

# Stage 3: the Elysia server bundle.
FROM deps AS server-builder
COPY packages/core/ packages/core/
COPY packages/server/ packages/server/
RUN bun run --filter '@webfrost/core' build \
    && bun run --filter '@webfrost/server' build

# Stage 4: production dependencies of the server only. The bundle keeps jsdom and playwright
# external (jsdom reads CSS from disk at load time, playwright ships a CLI), so they must be on disk.
FROM ${BUN_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/docs/package.json apps/docs/
COPY packages/cli/package.json packages/cli/
COPY packages/core/package.json packages/core/
COPY packages/sdk/package.json packages/sdk/
COPY packages/server/package.json packages/server/
COPY packages/ui/package.json packages/ui/
RUN bun install --frozen-lockfile --ignore-scripts --production --filter '@webfrost/server'
# bun links jsdom and playwright under packages/core/node_modules, where dist/index.js cannot
# resolve them. Link them from the root node_modules, which the bundle does find.
RUN mkdir -p node_modules/@mozilla \
    && ln -s ../packages/core/node_modules/jsdom node_modules/jsdom \
    && ln -s ../packages/core/node_modules/playwright node_modules/playwright \
    && ln -s ../../packages/core/node_modules/@mozilla/readability node_modules/@mozilla/readability

# Stage 5: runtime image.
FROM ${BUN_SLIM_IMAGE}
WORKDIR /app

# yt-dlp release to install, with the SHA-256 of each binary from the release's SHA2-256SUMS file.
# To upgrade: change all three values together (the build fails if the checksum does not match).
ARG YTDLP_VERSION=2026.10.26
ARG YTDLP_SHA256_AMD64=767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795
ARG YTDLP_SHA256_ARM64=e87e9533e89fe5889abaa21f5114dfe7756d6aa6219b83551add04d48b18e483
ARG TARGETARCH

COPY --from=prod-deps /app/node_modules ./node_modules
# The targets of the links in node_modules.
COPY --from=prod-deps /app/packages/core/node_modules ./packages/core/node_modules

# Runtime tools the extractors shell out to. Without them the server still starts,
# but every snapshot would be limited to HTML, WARC and Readability:
#   - Chromium (headless shell) for PDF, screenshot, DOM snapshot, SingleFile
#   - yt-dlp + ffmpeg for media extraction
# The Playwright CLI is run with bun because the image has no node binary.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg \
    && bun node_modules/playwright/cli.js install --with-deps --only-shell chromium \
    && case "${TARGETARCH:-amd64}" in \
         arm64) ytdlp_asset=yt-dlp_linux_aarch64; ytdlp_sha="${YTDLP_SHA256_ARM64}" ;; \
         *)     ytdlp_asset=yt-dlp_linux;         ytdlp_sha="${YTDLP_SHA256_AMD64}" ;; \
       esac \
    && curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/${ytdlp_asset}" -o /usr/local/bin/yt-dlp \
    && echo "${ytdlp_sha}  /usr/local/bin/yt-dlp" | sha256sum -c - \
    && chmod 0755 /usr/local/bin/yt-dlp \
    && apt-get purge -y --auto-remove curl \
    && rm -rf /var/lib/apt/lists/*

# Server bundle and UI static assets (served from ./public).
COPY --from=server-builder /app/packages/server/dist ./dist
COPY --from=ui-builder /app/packages/ui/dist ./public

# Run as an unprivileged user with a fixed UID/GID, so bind mounts can be chowned to match.
# The base image ships a "bun" user with UID 1000; replace it.
RUN userdel -r bun 2>/dev/null; \
    groupadd --gid 1000 webfrost \
    && useradd --uid 1000 --gid 1000 --create-home --shell /usr/sbin/nologin webfrost \
    && mkdir -p /data \
    && chown webfrost:webfrost /data

# Archive data (SQLite database + snapshot files). Mount a volume here: a new named volume
# copies this directory's ownership, a bind mount must be owned by UID 1000.
ENV WEBFROST_DIR=/data
VOLUME /data

USER webfrost
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "run", "dist/index.js"]
