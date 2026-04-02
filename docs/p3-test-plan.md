# P3 Test Plan — React UI & SDK

**Phase**: P3 (React UI + TypeScript SDK)
**Owner**: QA Engineer
**Status**: Draft
**Last updated**: 2026-04-02

---

## Overview

P3 introduces two new deliverables:

1. **`@webfrost/sdk`** — typed TypeScript client for the `@webfrost/server` REST API
2. **React UI** — browser dashboard with snapshot list, detail view, and search/filter

This document defines the test strategy, coverage requirements, and Definition of Done for QA sign-off.

---

## 1. SDK Unit Tests (`@webfrost/sdk`)

### 1.1 Scope

All public SDK methods must have unit tests. Based on the P3 server API surface:

| Method | Test file | Description |
|--------|-----------|-------------|
| `createSnapshot(url)` | `packages/sdk/src/client.test.ts` | POST `/snapshots` |
| `listSnapshots()` | `packages/sdk/src/client.test.ts` | GET `/snapshots` |
| `getSnapshot(id)` | `packages/sdk/src/client.test.ts` | GET `/snapshots/:id` |
| Constructor / base URL config | `packages/sdk/src/client.test.ts` | Base URL and headers |

### 1.2 Mock Strategy

SDK tests **must not** hit a real server. Use `bun:test` mocking:

```ts
import { mock } from "bun:test";

// Mock the global fetch
const fetchMock = mock(() =>
  Promise.resolve(new Response(JSON.stringify({ id: 1, url: "https://example.com", status: "pending" }), {
    status: 202,
    headers: { "content-type": "application/json" },
  }))
);
global.fetch = fetchMock;
```

**Why**: The SDK is a thin HTTP wrapper. The important invariants are correct URL construction, request method, JSON serialization, and typed response parsing — not server behavior (already tested in `@webfrost/server`).

### 1.3 Required Test Cases

#### `createSnapshot(url)`
- Sends `POST /snapshots` with `{ url }` body
- Returns parsed `{ id, url, status }` object
- Throws (or rejects) on non-2xx response
- Rejects invalid (non-HTTP/S) URLs before sending

#### `listSnapshots()`
- Sends `GET /snapshots`
- Returns typed `Snapshot[]` array
- Returns empty array when server returns `[]`

#### `getSnapshot(id)`
- Sends `GET /snapshots/:id`
- Returns typed `SnapshotDetail` object with `archiveResults`
- Throws `NotFoundError` (or equivalent) on 404

#### Client construction
- Accepts custom `baseUrl` (strips trailing slash)
- Default base URL is `http://localhost:3000`

### 1.4 Coverage Target

≥ 90% statement coverage on `packages/sdk/src/`.

---

## 2. UI Integration Tests

Test file location: `packages/ui/src/**/*.test.tsx` (co-located, using `bun test` + React Testing Library or equivalent for Bun).

### 2.1 Key User Flows

#### Flow 1 — Snapshot List (Dashboard)
| Step | Assertion |
|------|-----------|
| Render `<SnapshotList />` with mock SDK | Table/list renders with snapshot rows |
| SDK returns empty array | "No snapshots yet" empty state visible |
| SDK returns 3 snapshots | 3 rows rendered with URL and status |
| Click row / "View" button | Navigates to detail view (or calls detail handler) |

#### Flow 2 — Snapshot Detail View
| Step | Assertion |
|------|-----------|
| Render `<SnapshotDetail id={1} />` with mock SDK | Title/URL displayed |
| `archiveResults` array present | Each result type (WARC, Readability, PDF) rendered |
| `archiveResults` empty | "No archive results" or equivalent fallback shown |
| SDK throws 404 | Error state or redirect shown |

#### Flow 3 — Search / Filter
| Step | Assertion |
|------|-----------|
| Type in search box | List filters to matching URLs |
| Clear search | Full list restored |
| Filter by status (pending/done/error) | Only matching rows shown |

### 2.2 Mock Strategy

Wrap SDK calls behind a context/provider or prop injection so tests can inject a mock:

```tsx
// preferred pattern
<WebFrostProvider sdk={mockSdk}>
  <SnapshotList />
</WebFrostProvider>
```

Do **not** `global.fetch` mock in UI tests — test behavior at the component boundary.

---

## 3. E2E Playwright Smoke Test

### 3.1 Minimum Viable Smoke Test

File: `packages/ui/e2e/smoke.spec.ts`

```
start @webfrost/server (real, in-memory tmp dir)
  → navigate to UI root in Chromium
  → assert page title or "WebFrost" heading is visible
  → assert snapshot list container is rendered (even if empty)
  → POST /snapshots with a test URL
  → reload / wait for list update
  → assert one row appears in the list
```

This validates the full vertical slice: server → API → SDK → React render.

### 3.2 CI Requirements

- Uses Playwright Chromium (already cached in CI from P2 pipeline)
- Server process started as a fixture (`globalSetup` or `beforeAll`)
- Test is tagged `@smoke` so it can run independently
- Max runtime: 30 seconds

### 3.3 What E2E Does NOT Cover

E2E is not a substitute for unit or integration tests. Avoid duplicating coverage — E2E verifies the happy path, not error cases or edge conditions.

---

## 4. Definition of Done — P3

QA will sign off on P3 when **all** of the following are true:

### Code Quality
- [ ] `bun run lint` passes (no biome errors)
- [ ] `bun run typecheck` passes (no TypeScript errors)
- [ ] `bun run test` passes — all suites green, no skipped tests

### SDK Coverage
- [ ] All public SDK methods have unit tests per §1.3
- [ ] Mock strategy uses `bun:test` mocks, not real server
- [ ] Coverage ≥ 90% on `packages/sdk/src/`

### UI Integration Coverage
- [ ] Snapshot list: renders data, empty state, click navigation
- [ ] Snapshot detail: renders results, 404 error state
- [ ] Search/filter: filters list by URL and status

### E2E
- [ ] At least one Playwright smoke test per §3.1 passes in CI
- [ ] Tagged `@smoke`, runs in < 30 s

### Performance Baselines
- [ ] SDK call latency baseline added to `bench/`
- [ ] Page load benchmark (time to interactive with 10 snapshots) captured

### Documentation
- [ ] `docs/DEPLOY.md` updated if Docker image includes UI
- [ ] SDK README includes install + usage example

---

## 5. Out of Scope for P3 QA

The following are deferred to a later phase:

- Accessibility (a11y) audits — nice-to-have, not blocking
- Visual regression testing — deferred until UI stabilises
- Load testing the server with concurrent UI clients

---

## References

- Parent epic: [WEB-4](/WEB/issues/WEB-4) — P3 React UI & SDK
- Server route tests: `packages/server/src/routes/snapshots.test.ts`
- Core pipeline tests: `packages/core/src/index.test.ts`
- Existing E2E baseline: `packages/cli/src/integration.test.ts`
