# Threat Model — WebFrost

**Version:** P4 (2026-04-02)
**Scope:** `@webfrost/core`, `@webfrost/cli`, `@webfrost/server`, `@webfrost/ui`

---

## System Overview

WebFrost is a self-hosted archiving toolkit. The operator runs the server on their own
infrastructure; users (via the UI/API) submit URLs to capture. The system fetches those URLs
using a Node/Bun HTTP client and a headless Chromium instance, then stores the result in a local
SQLite database and flat files.

```
User / Operator
      │  POST /api/snapshots { url }
      ▼
┌──────────────────────┐
│  @webfrost/server    │   Elysia HTTP server (port 3000)
│  routes/snapshots.ts │
└──────────┬───────────┘
           │  addUrl(db, url, dir)
           ▼
┌──────────────────────┐
│  @webfrost/core      │
│  pipeline.ts         │──── fetch(url) ──────▶  External Internet
│                      │
│  Extractors:         │──── Playwright ──────▶  Headless Chromium
│  • html              │
│  • warc              │──── Bun.file() ──────▶  Local filesystem
│  • readability       │
│  • pdf               │──── SQLite ──────────▶  archive.db
└──────────────────────┘
```

---

## Trust Boundaries

| Boundary | Trust Level |
|----------|-------------|
| Operator (runs the server) | Fully trusted |
| Authenticated API user | Trusted to submit URLs; not trusted re: SSRF/path traversal |
| Archived content (fetched HTML/resources) | **Untrusted** |
| External DNS / network | Untrusted |
| Local filesystem (`snapshots/`) | Trusted (operator-controlled path) |

WebFrost currently has **no authentication layer**. Any client that can reach port 3000 can
submit URLs and download archived content. Deployment behind a firewall or reverse-proxy with
auth is assumed.

---

## Attack Surface

### 1. URL submission endpoint — `POST /api/snapshots`

- **Who can reach it:** Anyone with network access to port 3000.
- **What it does:** Enqueues a fetch + extraction job for the supplied URL.
- **Threats:**
  - **SSRF (critical):** Attacker supplies a private/loopback IP or cloud metadata URL. The
    server fetches it and stores the response. No IP blocklist exists today.
    *Tracking: [WEB-48](/WEB/issues/WEB-48)*
  - **Amplification / DoS:** Attacker supplies a URL pointing to a large file. `fetch()` has no
    response size cap; memory exhaustion is possible.
  - **Open redirect follow-through:** `fetch()` follows 3xx redirects. A redirect chain can
    lead to a private address that bypasses a future pre-fetch IP check if redirect targets are
    not re-validated.

### 2. Headless Chromium (PDF extractor)

- **What it does:** Launches Playwright Chromium to navigate to the URL and capture a PDF.
- **Threats:**
  - **Browser-based SSRF:** Chromium navigates to the URL; even if `fetch()` is hardened,
    the browser can still reach `file://` or `javascript:` URIs unless Chromium launch flags
    disallow them.
  - **Sandbox escape:** If Chromium is run without a sandbox (`--no-sandbox`), a browser
    exploit targeting a malicious page could escape to the host OS. Always run with the default
    Chromium sandbox enabled.
  - **Resource exhaustion:** A malicious page with infinite redirects or heavy JavaScript can
    stall or crash the browser instance.

### 3. Archive download endpoint — `GET /api/snapshots/:id/archives/:extractor/download`

- **What it does:** Returns stored archive content (WARC file path, PDF file path, or raw HTML/
  JSON) for a given snapshot.
- **Threats:**
  - **Parameter injection:** `extractor` is not validated against the known set. An attacker
    supplying an unexpected value gets an empty response, but this should be hardened with an
    allowlist.
    *Tracking: [WEB-51](/WEB/issues/WEB-51)*
  - **Path traversal (indirect):** For `warc` and `pdf` extractors the stored `content` column
    is a filesystem path passed directly to `Bun.file()`. If the pipeline is compromised or a
    row is manually crafted, a path outside `snapshots/` could be served.
  - **Stored XSS (latent):** The `html` extractor stores verbatim HTML. It is currently served
    only as a download. If a future "preview" feature serves it inline without a sandboxed
    context, any script in the archived page executes in the origin of the WebFrost server.
    *Tracking: [WEB-49](/WEB/issues/WEB-49)*

### 4. CLI — `webfrost add <url>`

- **What it does:** Passes command-line argument directly to `addUrl()`.
- **Threats:**
  - **No client-side URL validation:** An invalid or non-HTTP URL (e.g. `file:///etc/passwd`)
    is passed to `addUrl()` which calls `fetch()`. On the CLI path there is no protocol check.
    *Tracking: [WEB-50](/WEB/issues/WEB-50)*

### 5. Static file serving (`public/`)

- **What it does:** Elysia's `staticPlugin` serves built UI assets.
- **Threats:**
  - Low risk — assets are build-time artefacts. No user-supplied content in this path.
  - Missing `X-Content-Type-Options: nosniff` could allow MIME-sniffing in older browsers.

### 6. SQLite database (`archive.db`)

- **What it does:** Persists snapshot metadata and archive content.
- **Threats:**
  - All queries use parameterised statements — SQL injection is mitigated.
  - The database file is world-readable on disk if the operator does not restrict filesystem
    permissions. Recommend `chmod 600 archive.db`.

---

## Known Risks Summary

| Risk | Severity | Status | Issue |
|------|----------|--------|-------|
| SSRF via bare `fetch()` | Critical | **Open** | [WEB-48](/WEB/issues/WEB-48) |
| No CSP header on server responses | High | **Open** | [WEB-49](/WEB/issues/WEB-49) |
| No URL validation in CLI | Medium | **Open** | [WEB-50](/WEB/issues/WEB-50) |
| Extractor param not allowlisted | Medium | **Open** | [WEB-51](/WEB/issues/WEB-51) |
| No response size cap | Medium | **Open** | (file via WEB-48) |
| Redirect follow-through SSRF | Medium | **Open** | (file via WEB-48) |
| Stored XSS (latent — downloads only) | Low/High* | **Latent** | [WEB-49](/WEB/issues/WEB-49) |
| Chromium `--no-sandbox` risk | Medium | Monitor | deployment config |
| DB file permissions | Low | Ops | docs/DEPLOY.md |

\* Low today (download only); High if inline preview is added without sandboxing.

---

## Mitigations In Place

| Control | Where |
|---------|-------|
| HTTP/HTTPS protocol allowlist | `server/routes/snapshots.ts` |
| Parameterised SQL queries | all `db.query()` calls in `@webfrost/core` |
| `Content-Disposition: attachment` on file downloads | `server/routes/snapshots.ts` |
| Archive content isolated to `snapshots/` subdirectory | `pipeline.ts`, `warcExtractor`, `pdfExtractor` |

---

## Out of Scope

- Multi-tenant isolation — WebFrost is single-tenant by design.
- Authentication / authorisation — left to the operator's reverse proxy.
- TLS — terminate at the reverse proxy (see `docs/DEPLOY.md`).
