# Security Policy — WebFrost

WebFrost is a self-hosted web archiving toolkit. It fetches arbitrary URLs supplied by its users
and stores what comes back, so the two things it has to get right are **who may ask it to fetch**
and **where it may be made to connect**. This page describes the controls that exist today, how to
configure them, and what is still your job as the operator.

For the structured analysis (assets, trust boundaries, risks by component) see the
[Threat Model](THREAT-MODEL.md).

---

## Authentication

Every `/api/*` route requires authentication except `POST /api/auth/login`,
`GET /api/setup/status` and `POST /api/setup` (which only works while no admin user exists).

| Mechanism | Details |
|---|---|
| Admin password | bcrypt (cost 10) via `Bun.password`. Minimum 8 characters. A failed login takes the same time whether or not the username exists. |
| Session cookie | `HttpOnly`, `SameSite=Strict`, `Secure`. HMAC-SHA256 signed with `SESSION_SECRET` **and** backed by a row in the `sessions` table. Expires after 7 days. |
| API keys | 256-bit random, shown once, stored as SHA-256 hashes. Optional expiry; revocable. Sent as `Authorization: Bearer <key>`. |

Sessions are revocable:

- **Logout** deletes the server-side session, so a copied cookie stops working immediately.
- **Changing the password** deletes every session of that user and issues a fresh one to the
  caller. Use it if you suspect a cookie leaked.

`SESSION_SECRET` is mandatory (the server refuses to start without it) and should be at least 32
random characters: `openssl rand -hex 32`. Rotating it invalidates every session.

`AUTH_DISABLED=true` turns all of the above off. It exists for local development and automated
tests. Never set it on anything reachable from a network you do not fully control.

### Public read / private write

`WEBFROST_PUBLIC_READ=true` lets anonymous visitors **read** the archive: list, search and open
snapshots, their tags and archived files, and the stats card. Nothing else changes: every write,
and the schedules, imports, settings and API-key routes, still require a session or an API key.
The allowlist is explicit and matched on method and exact path, so a new route is private unless
it is added to it.

Anonymous responses do not include storage paths (local file paths or S3 keys). Remember that
everything you have archived becomes visible to anyone who can reach the server — including
pages that were themselves private when you captured them.

### Cookies over plain HTTP

Browsers drop `Secure` cookies on plain-HTTP origins other than `localhost`, so logging in through
`http://192.168.1.10:3000` appears to succeed and then bounces back to the login page. Put the
server behind TLS, or — for an HTTP-only LAN deployment you accept the risk of — set
`WEBFROST_INSECURE_COOKIES=true`.

---

## Rate limiting

In-memory, sliding one-minute window, per client IP:

| Scope | Limit |
|---|---|
| `POST /api/auth/login`, `/api/auth/change-password`, `/api/setup` | 10 / min |
| `POST /api/snapshots`, `/api/import`, `/api/import/file` | 60 / min |
| `GET` / `HEAD` on `/api/*` | 300 / min |

A limited request gets `429` with a `Retry-After` header.

The client is identified by its TCP peer address. `X-Forwarded-For` is ignored by default because
any client can set it. Behind a reverse proxy every request would then share the proxy's address,
so set `WEBFROST_TRUST_PROXY=true` there — and make sure the proxy **overwrites** the header rather
than appending to a client-supplied one.

Background pipelines are bounded separately by `WEBFROST_CONCURRENCY` (default 3), so the write
limit cannot translate into dozens of simultaneous headless browsers.

With public read enabled, anonymous visitors share the same read limit per client address.

---

## SSRF (Server-Side Request Forgery)

Anyone who can create a snapshot can make the server issue HTTP requests. WebFrost restricts where
those requests may go.

**What is blocked** (for both IPv4 and IPv6, including IPv4-mapped and NAT64 forms): loopback,
RFC 1918 private ranges, carrier-grade NAT (`100.64.0.0/10`), link-local (`169.254.0.0/16`, which
covers cloud metadata endpoints), unique-local and site-local IPv6, multicast and reserved ranges.
Only `http:` and `https:` URLs are accepted.

**Where it is enforced:**

| Path | Enforcement |
|---|---|
| Initial page fetch, RSS/OPML feed fetch, SingleFile asset inlining | `safeFetch`: resolves the host, rejects blocked addresses, follows redirects manually and re-checks every hop, caps the body at 50 MB, times out after 30 s. |
| Headless Chromium (PDF, screenshot, DOM snapshot, SingleFile) | Every request the page makes — navigation, iframes, images, scripts, `fetch`/XHR, WebSockets — is checked and aborted if the host is blocked. Service workers are disabled. |
| Redirects inside the browser | Chromium does not allow intercepting a redirect hop. If any hop lands on a blocked host the browser extractors are **not run** for that snapshot and are recorded as failed, so the response is never captured. The request itself may still have been sent (blind SSRF). |
| After the page has loaded | The browser context is taken offline before anything is captured, so a script cannot wait out the check and then pull an internal URL into a frame. |

**Opt-out:** `WEBFROST_ALLOW_PRIVATE_URLS=true` disables the address check everywhere, for
deployments that intentionally archive intranet pages. The `http(s)`-only rule still applies.

### Residual risks

- **DNS rebinding.** The guard resolves a hostname and the HTTP client then resolves it again. An
  attacker controlling a domain's DNS with a very short TTL can return a public address to the
  first lookup and a private one to the second.
- **Blind requests through browser redirects**, as described above.
- **yt-dlp** makes its own requests and follows its own redirects. It is only invoked for a URL
  that already passed `safeFetch`, but it is not otherwise constrained.

If WebFrost archives URLs from people you do not fully trust, treat the application-level guard as
one layer and add a network-level one: run the container in a network with no route to your
internal ranges and to `169.254.169.254`, or apply egress firewall rules.

---

## Content Security

The server sets these headers on every response:

```
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
                         img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-src 'self';
                         frame-ancestors 'none'; base-uri 'self'; form-action 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
```

With the S3 backend, downloads redirect to presigned URLs on the bucket's host, so that one origin
is added to `img-src` and `media-src` (and to nothing else).

Archived content is **untrusted**:

- Archived files (HTML, DOM snapshot, SingleFile, PDF, WARC, media) are downloaded with
  `Content-Disposition: attachment`.
- The in-app preview of a DOM snapshot or SingleFile archive is served by a separate endpoint
  (`GET /api/snapshots/:id/archives/:extractor/preview`) with its own policy:

  ```
  Content-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline';
                           img-src data:; font-src data:; media-src data:; frame-ancestors 'self'
  ```

  `sandbox` gives the document an opaque origin and disables scripts, forms, popups and
  top-level navigation, even when the URL is opened directly. Nothing can be loaded from the
  network, so a previewed page cannot phone home. The UI additionally frames it with
  `<iframe sandbox="">`. `frame-src 'self'` in the app policy exists only for this iframe.
- Search snippets are built from archived text. The server HTML-escapes the text and adds only
  `<mark>` highlights; the UI additionally renders them as text nodes, never as HTML.
- The Reader view renders extracted article text as plain text.

Any new feature that displays archived content must go through the same sandboxed preview —
never add `allow-scripts` or `allow-same-origin` to that iframe, and never serve archived HTML
inline from a route that carries the app's own policy.

---

## Input validation

- URLs: `http:`/`https:` only, on the server and in the CLI.
- `GET /api/snapshots/:id/archives/:extractor/download`: `extractor` is checked against an
  allowlist, and the stored file reference is validated against the storage backend before any
  read (local path must be inside `snapshots/`; S3 keys must be under the configured prefix).
- All SQL uses bound parameters. Full-text queries are passed to FTS5 as a bound parameter; a
  syntactically invalid query returns no results.

---

## Resource limits

| Limit | Default | Setting |
|---|---|---|
| Parallel pipelines | 3 | `WEBFROST_CONCURRENCY` |
| HTTP fetch timeout | 30 s | `WEBFROST_FETCH_TIMEOUT_MS` |
| HTTP response size | 50 MB | — |
| Browser navigation timeout | 30 s | — |
| Per-extractor timeout | 60 s | `WEBFROST_EXTRACTOR_TIMEOUT_MS` |
| yt-dlp process timeout | 10 min | `WEBFROST_MEDIA_TIMEOUT_MS` |
| Browser shutdown | 5 s | — |
| Media file size | 500 MB | — |
| Gap between archives of one host | 1 s | `WEBFROST_DOMAIN_DELAY_MS` |

---

## Deployment checklist

- [ ] `SESSION_SECRET` set from a secret store, ≥ 32 random characters.
- [ ] `AUTH_DISABLED` unset.
- [ ] TLS terminated in front of the server; `WEBFROST_TRUST_PROXY=true` if (and only if) that
      proxy sets `X-Forwarded-For`.
- [ ] `WEBFROST_ALLOW_PRIVATE_URLS` unset unless you archive intranet pages on purpose.
- [ ] `WEBFROST_PUBLIC_READ` set only if everything in the archive may be seen by anyone who can
      reach the server.
- [ ] Egress from the container to internal networks and metadata endpoints blocked.
- [ ] The data directory (`WEBFROST_DIR`) readable only by the service user; it contains the
      database, password hash, API key hashes and every archived page.
- [ ] Backups of the data directory.

The published image runs the process as root inside the container and launches Chromium without
its own sandbox (Playwright's default). The container boundary is the sandbox: do not add
capabilities or mount the host filesystem.

---

## Dependencies

Run `bun audit` periodically. The dependencies that parse untrusted input are `jsdom` and
`@mozilla/readability` (article extraction), `playwright` + Chromium (rendering) and `yt-dlp`
(media). Keep the image up to date to pick up Chromium and yt-dlp fixes.

---

## Reporting vulnerabilities

Please report vulnerabilities privately rather than in a public issue: use **Security → Report a
vulnerability** on the [GitHub repository](https://github.com/gtkatakura/webfrost/security). Include the affected version or commit, reproduction steps and the
impact you observed. Allow up to 90 days for a fix before public disclosure.
