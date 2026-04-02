# Security Policy — WebFrost

## Overview

WebFrost is a self-hosted web archiving toolkit. It fetches and stores arbitrary URLs supplied by
users or operators. This document covers known attack surface, recommended deployment hardening,
and the Content-Security-Policy policy for the HTTP server.

---

## Content-Security-Policy (CSP)

The `@webfrost/server` package does **not** currently set a `Content-Security-Policy` response
header. Until [WEB-46](/WEB/issues/WEB-46) (server CSP hardening) is resolved, operators **must**
apply the header at the reverse-proxy layer.

### Recommended policy for the API + UI server

```
Content-Security-Policy:
  default-src 'none';
  script-src  'self';
  style-src   'self' 'unsafe-inline';
  img-src     'self' data:;
  font-src    'self';
  connect-src 'self';
  frame-ancestors 'none';
  base-uri    'self';
  form-action 'self';
```

**Important:** Archived HTML is currently stored verbatim and served only as a file download
(`Content-Disposition: attachment`). If a future feature ever serves archived HTML inline (e.g. a
"preview" endpoint), that response **must** use a sandboxed iframe or a strict per-response
`Content-Security-Policy: sandbox` header to prevent stored-XSS execution.

### Nginx snippet

```nginx
add_header Content-Security-Policy
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self';"
  always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

---

## SSRF (Server-Side Request Forgery)

**Status: unmitigated — see [WEB-47](/WEB/issues/WEB-47)**

`packages/core/src/pipeline.ts` calls `fetch(url)` with the raw user-supplied URL. There is
currently **no blocklist for private, loopback, link-local, or cloud metadata addresses**.

An attacker with API access can probe the internal network:

```
POST /api/snapshots { "url": "http://127.0.0.1:6379" }           # Redis
POST /api/snapshots { "url": "http://169.254.169.254/latest" }   # AWS/GCP metadata
POST /api/snapshots { "url": "http://10.0.0.1:22" }              # Internal SSH
```

### Mitigation (to be implemented in WEB-47)

Before calling `fetch()`, resolve the hostname and reject requests whose IP falls within:

| CIDR | Reason |
|------|--------|
| `127.0.0.0/8` | Loopback |
| `10.0.0.0/8` | Private |
| `172.16.0.0/12` | Private |
| `192.168.0.0/16` | Private |
| `169.254.0.0/16` | Link-local / cloud metadata |
| `::1/128` | IPv6 loopback |
| `fc00::/7` | IPv6 ULA |

Provide an opt-out flag (`WEBFROST_ALLOW_PRIVATE_URLS=true`) for operators who intentionally
archive intranet content.

---

## Input Validation

### URL inputs

- **Server** (`POST /api/snapshots`): validates `http:`/`https:` protocol — no SSRF check yet.
- **CLI** (`webfrost add <url>`): passes URL directly to `addUrl()` without any validation.
  See [WEB-48](/WEB/issues/WEB-48).

### Path / extractor parameter

`GET /api/snapshots/:id/archives/:extractor/download` — the `extractor` path segment is passed to
SQLite as a parameter (preventing injection) but is **not validated** against the known set of
extractor names (`html`, `warc`, `pdf`, `readability`). See [WEB-49](/WEB/issues/WEB-49).

File paths stored in `archive_results.content` for WARC and PDF extractors are passed to
`Bun.file()` without verifying the path is within the expected `snapshots/` directory.

---

## Response Safety

- **Response size**: `fetch()` imposes no size limit. A malicious server can trigger OOM.
  Recommend capping at 50 MB and streaming to disk rather than buffering in memory.
- **Redirect handling**: Bun's `fetch()` follows redirects by default. A redirect to a private
  IP bypasses the pre-fetch IP check; follow-through SSRF is possible. Use `redirect: "manual"`
  and validate the `Location` header before following.
- **Content-Type**: Returned HTML is parsed by JSDOM and Mozilla Readability. Malformed or
  adversarial HTML should be safe (both libraries are well-fuzzed), but server-side resource
  exhaustion via deeply nested DOM trees is possible.

---

## Dependency Security

Run `bun audit` (or `npm audit`) periodically. Key dependencies with broad HTTP parsing surface:

- `jsdom` — DOM/HTML parsing (readability extractor)
- `@mozilla/readability` — HTML extraction
- `playwright` — headless Chromium (PDF extractor)
- `elysia` — HTTP framework

---

## Reporting Vulnerabilities

This project is self-hosted open-source software. File security issues privately by opening a
confidential issue or emailing the maintainers before public disclosure. Allow a 90-day remediation
window before publishing details.
