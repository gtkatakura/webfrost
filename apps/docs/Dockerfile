# The documentation site, built from the repo root: docker build -f apps/docs/Dockerfile .
# Tag and digest: the tag says which version, the digest makes sure it is the same bytes everywhere.
# Bun 1.4.4, the version in mise.toml (1.3.11 also failed to prerender the pages inside a container: a 500 from
# React Router's preview server with no error shown). Keep it in step with mise.toml.
FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS build
WORKDIR /app
# Every workspace manifest, so the lockfile resolves; only the docs app's dependencies matter here.
COPY package.json bun.lock ./
COPY packages/cli/package.json packages/cli/
COPY packages/core/package.json packages/core/
COPY packages/sdk/package.json packages/sdk/
COPY packages/server/package.json packages/server/
COPY packages/ui/package.json packages/ui/
COPY apps/docs/package.json apps/docs/
RUN bun install --frozen-lockfile --ignore-scripts
COPY apps/docs apps/docs
# Served as /compose.yml by the site (see vite.config.ts).
COPY docker-compose.prod.yml ./
WORKDIR /app/apps/docs
# Pages are prerendered and images resized here (vite-imagetools); then the server is bundled to one file.
RUN bun run build && bun build src/main.ts --target bun --outfile build/server.js

# What runs holds only the pages, already written out, and the few lines that hand them out.
FROM oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4
WORKDIR /app
COPY --from=build /app/apps/docs/build/client build/client
COPY --from=build /app/apps/docs/build/server.js build/server.js
ENV PORT=3000
USER bun
EXPOSE 3000
HEALTHCHECK CMD bun -e "fetch('http://localhost:3000/up').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "build/server.js"]
