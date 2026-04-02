# Stage 1 — build the React UI
FROM oven/bun:1 AS ui-builder
WORKDIR /app

# Copy workspace manifests for layer caching
COPY package.json bun.lock ./
COPY packages/ui/package.json packages/ui/
COPY packages/sdk/package.json packages/sdk/

# Install UI + SDK deps
RUN bun install --frozen-lockfile

# Copy UI + SDK source and build
COPY packages/sdk/ packages/sdk/
COPY packages/ui/ packages/ui/
RUN bun run --filter '@webfrost/ui' build

# Stage 2 — build the Elysia server
FROM oven/bun:1 AS server-builder
WORKDIR /app

# Copy workspace manifests for layer caching
COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/

# Install server + core deps
RUN bun install --frozen-lockfile

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
