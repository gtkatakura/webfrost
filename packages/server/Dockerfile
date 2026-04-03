# Stage 1 — build the React UI
FROM oven/bun:1 AS ui-builder
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
FROM oven/bun:1 AS server-builder
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

# Stage 3 — minimal runtime image
FROM oven/bun:1-slim
WORKDIR /app

# Server bundle
COPY --from=server-builder /app/packages/server/dist ./dist

# UI static assets served from ./public by @elysiajs/static
COPY --from=ui-builder /app/packages/ui/dist ./public

EXPOSE 3000
CMD ["bun", "run", "dist/index.js"]
