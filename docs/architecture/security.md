---
title: Security
description: Security architecture of WebFrost. Authentication, SSRF protection, rate limits, and deployment hardening, with detail in the security policy.
---

# Security

This page is a short architectural summary. The authoritative description — guarantees, residual risks, deployment checklist and how to report a vulnerability — is in the [Security policy](/SECURITY), with the [threat model](/THREAT-MODEL) behind it.

## Authentication

All `/api/*` routes require authentication except `POST /api/auth/login`, `GET /api/setup/status` and `POST /api/setup`.

- **Session cookie** — set after login (or setup). It is signed with `SESSION_SECRET` and backed by a row in the `sessions` table, so logout revokes it and changing the password revokes every session of the user. The cookie is `HttpOnly`, `SameSite=Strict` and `Secure`.
- **Bearer token** — an API key in `Authorization: Bearer <key>`, created via `webfrost admin key create` or **Settings → API Keys**. Keys are stored as SHA-256 hashes and shown only once.
- **Passwords** are hashed with bcrypt and must be at least 8 characters. WebFrost supports a single admin user.
- `AUTH_DISABLED=true` bypasses all authentication. Local development only.

Because the `Secure` flag makes browsers drop the cookie on plain-HTTP, non-localhost origins, serve WebFrost over TLS. For an HTTP-only deployment, `WEBFROST_INSECURE_COOKIES=true` removes the flag.

## SSRF protection

WebFrost fetches URLs supplied by users. The fetch step and every request made by the headless browser (navigation and sub-resources) go through an SSRF guard that rejects loopback, private and link-local addresses. `WEBFROST_ALLOW_PRIVATE_URLS=true` turns that off for intranet archiving. See [Security policy](/SECURITY) for the exact rules and residual risks, and still keep the archive server on a network where internal services are not reachable.

## Rate limiting

Requests are limited per client IP over a one-minute sliding window: 300 for `GET`/`HEAD` on `/api/*`, 60 for the endpoints that start archives (`POST /api/snapshots`, `/api/import`, `/api/import/file`) and 10 for the password endpoints (`/api/auth/login`, `/api/auth/change-password`, `/api/setup`). Limited requests get `429` with `Retry-After`. Behind a reverse proxy, set `WEBFROST_TRUST_PROXY=true` so the client address is read from `X-Forwarded-For`. See [REST API](/reference/rest-api#rate-limits).

## Response headers and archived content

The server sets a `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy` header on its responses. Archived content is untrusted: archive files are served as downloads (`Content-Disposition: attachment`), never rendered in the WebFrost origin, and search snippets are HTML-escaped with only `<mark>` as markup.

## Deployment

- Run WebFrost behind nginx, Caddy or Traefik for TLS. WebFrost does not terminate TLS itself.
- Use a random `SESSION_SECRET` of at least 32 characters (`openssl rand -hex 32`) from a secret manager.
- Never expose `AUTH_DISABLED=true`.

See the deployment checklist in the [Security policy](/SECURITY).
