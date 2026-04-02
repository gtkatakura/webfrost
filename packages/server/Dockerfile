# Build stage — install deps and bundle the server
FROM oven/bun:1 AS builder
WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json bun.lockb ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/

# Install all workspace deps (includes core as workspace:*)
RUN bun install --frozen-lockfile

# Copy source for all packages needed by the server
COPY packages/core/ packages/core/
COPY packages/server/ packages/server/

# Build core first, then bundle server (bun build bundles deps into dist/index.js)
RUN bun run --filter '@webfrost/core' build
RUN bun run --filter '@webfrost/server' build

# Runtime stage — minimal image with only the bundled output
FROM oven/bun:1-slim
WORKDIR /app

COPY --from=builder /app/packages/server/dist ./dist

EXPOSE 3000
CMD ["bun", "run", "dist/index.js"]
