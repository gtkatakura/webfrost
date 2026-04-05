---
title: Security
description: Authentication model, deployment hardening, and security considerations for WebFrost.
---

# Security

## Authentication model

### Server authentication

All `/api/*` routes require authentication except:
- `POST /api/auth/login`
- `GET /health`
- `GET /api/setup/status`
- `POST /api/setup`

Two supported methods:
- **Session cookie** — set after `POST /api/auth/login` with `{ username, password }`
- **Bearer token** — API key in the `Authorization: Bearer <key>` header

### API keys

API keys are created via `webfrost admin key create` or **Settings → API Keys** in the UI. Keys are stored as SHA-256 hashes — the plain-text key is shown only once at creation.

### `AUTH_DISABLED`

Setting `AUTH_DISABLED=true` bypasses all authentication. **This is for local development only.** Never set it on a publicly accessible server.

### Passwords

Admin passwords are hashed with bcrypt. WebFrost currently supports a single admin user.

## Deployment hardening

### Reverse proxy

Run WebFrost behind nginx, Caddy, or Traefik for TLS. WebFrost does not handle TLS directly.

### Content-Security-Policy

`@webfrost/server` does not currently set a `Content-Security-Policy` header. Apply it at the reverse proxy:

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

**nginx:**

```nginx
add_header Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none';" always;
```

### Archived HTML

Archived HTML is stored verbatim and served as a file download (`Content-Disposition: attachment`). If a future feature serves archived HTML inline, it must use a sandboxed iframe or a strict per-response `Content-Security-Policy: sandbox` header to prevent stored XSS.

### Path traversal

File download routes resolve extractor file paths from the database — they do not accept user-supplied paths. Archive files are written to `WEBFROST_DIR/<snapshot-id>/<filename>` and read back using the same stored path.

### SSRF considerations

WebFrost fetches arbitrary URLs supplied by users. In a shared or multi-tenant deployment, this could allow SSRF (Server-Side Request Forgery) against internal services. Mitigations:

- Deploy on an isolated network or VPC with no internal services reachable from the archive server.
- Use network-level egress filtering to block private IP ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`).

### `SESSION_SECRET`

Use a cryptographically random `SESSION_SECRET` of at least 32 characters. Generate it with:

```bash
openssl rand -hex 32
```

Store it in a secret manager, not in a `.env` file in production.

## Full security policy

See `docs/SECURITY.md` in the repo for the complete security policy, threat model, and vulnerability reporting process.
