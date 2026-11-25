import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { WebFrostClient, WebFrostError } from "./client";
import type { Snapshot } from "./types";

const BASE = "http://localhost:3000";

let fetchSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  fetchSpy = spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("WebFrostClient.createSnapshot", () => {
  test("returns SnapshotCreated on 202", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: 1, url: "https://example.com", status: "pending" }, 202),
    );

    const client = new WebFrostClient({ baseUrl: BASE });
    const result = await client.createSnapshot("https://example.com");

    expect(result).toEqual({ id: 1, url: "https://example.com", status: "pending" });
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`${BASE}/api/v1/snapshots`);
    expect(calledInit.method).toBe("POST");
    expect(calledInit.body).toBe(JSON.stringify({ url: "https://example.com" }));
  });

  test("throws WebFrostError with message on 400", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: "invalid url" }, 400));

    const client = new WebFrostClient({ baseUrl: BASE });
    let caught: unknown;
    try {
      await client.createSnapshot("not-a-url");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WebFrostError);
    expect((caught as WebFrostError).status).toBe(400);
    expect((caught as WebFrostError).message).toBe("invalid url");
  });

  test("sends colorScheme in the body when given, and only { url } otherwise", async () => {
    fetchSpy.mockImplementation(async () =>
      jsonResponse({ id: 3, url: "https://example.com", status: "pending" }, 202),
    );
    const client = new WebFrostClient({ baseUrl: BASE });

    await client.createSnapshot("https://example.com", { colorScheme: "dark" });
    await client.createSnapshot("https://example.com");

    const bodies = (fetchSpy.mock.calls as unknown as Array<[string, RequestInit]>).map(
      (c) => c[1].body,
    );
    expect(bodies[0]).toBe(JSON.stringify({ url: "https://example.com", colorScheme: "dark" }));
    expect(bodies[1]).toBe(JSON.stringify({ url: "https://example.com" }));
  });

  test("strips trailing slash from baseUrl", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: 2, url: "https://foo.com", status: "pending" }, 202),
    );

    const client = new WebFrostClient({ baseUrl: "http://localhost:3000/" });
    await client.createSnapshot("https://foo.com");

    expect((fetchSpy.mock.calls[0] as unknown[])[0]).toBe("http://localhost:3000/api/v1/snapshots");
  });
});

describe("WebFrostClient.listSnapshots", () => {
  test("returns paginated result", async () => {
    const rawItems: Snapshot[] = [
      {
        id: 1,
        url: "https://a.com",
        status: "done",
        failure: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        extractors: ["warc"],
        tags: [],
        title: null,
        excerpt: null,
        screenshotUrl: null,
      },
      {
        id: 2,
        url: "https://b.com",
        status: "pending",
        failure: null,
        createdAt: "2024-01-02T00:00:00.000Z",
        extractors: [],
        tags: [],
        title: null,
        excerpt: null,
        screenshotUrl: null,
      },
    ];
    fetchSpy.mockResolvedValueOnce(jsonResponse({ items: rawItems, total: 2, page: 1, limit: 20 }));

    const client = new WebFrostClient({ baseUrl: BASE });
    const result = await client.listSnapshots();

    expect(result.items).toEqual(rawItems);
    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect((fetchSpy.mock.calls[0] as unknown[])[0]).toBe(`${BASE}/api/v1/snapshots`);
  });

  test("passes page and limit as query params", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ items: [], total: 0, page: 2, limit: 5 }));

    const client = new WebFrostClient({ baseUrl: BASE });
    await client.listSnapshots({ page: 2, limit: 5 });

    expect((fetchSpy.mock.calls[0] as unknown[])[0]).toBe(
      `${BASE}/api/v1/snapshots?page=2&limit=5`,
    );
  });

  test("throws WebFrostError on non-200", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 500, statusText: "Server Error" }));

    const client = new WebFrostClient({ baseUrl: BASE });
    await expect(client.listSnapshots()).rejects.toBeInstanceOf(WebFrostError);
  });
});

describe("WebFrostClient.listSnapshots — status filter", () => {
  test("passes status as query param", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ items: [], total: 0, page: 1, limit: 20 }));

    const client = new WebFrostClient({ baseUrl: BASE });
    await client.listSnapshots({ status: "done" });

    expect((fetchSpy.mock.calls[0] as unknown[])[0]).toBe(`${BASE}/api/v1/snapshots?status=done`);
  });

  test("combines status with page and limit params", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ items: [], total: 0, page: 1, limit: 10 }));

    const client = new WebFrostClient({ baseUrl: BASE });
    await client.listSnapshots({ page: 1, limit: 10, status: "pending" });

    expect((fetchSpy.mock.calls[0] as unknown[])[0]).toBe(
      `${BASE}/api/v1/snapshots?page=1&limit=10&status=pending`,
    );
  });
});

describe("WebFrostClient.updateSchedule", () => {
  test("sends PATCH with paused body and returns updated schedule", async () => {
    const schedule = {
      id: 1,
      url: "https://example.com",
      cron: "*/5 * * * *",
      createdAt: "2024-01-01T00:00:00.000Z",
      lastRunAt: null,
      nextRunAt: "2024-01-01T00:05:00.000Z",
      paused: true,
      lastStatus: null,
      consecutiveFailures: 0,
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(schedule));

    const client = new WebFrostClient({ baseUrl: BASE });
    const result = await client.updateSchedule(1, { paused: true });

    expect(result).toEqual(schedule);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`${BASE}/api/v1/schedules/1`);
    expect(calledInit.method).toBe("PATCH");
    expect(calledInit.body).toBe(JSON.stringify({ paused: true }));
  });

  test("throws WebFrostError on 404", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: "not found" }, 404));

    const client = new WebFrostClient({ baseUrl: BASE });
    let caught: unknown;
    try {
      await client.updateSchedule(9999, { paused: true });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WebFrostError);
    expect((caught as WebFrostError).status).toBe(404);
  });
});

describe("WebFrostClient.getSnapshot", () => {
  test("returns SnapshotDetail with mapped archiveResults", async () => {
    const raw = {
      id: 1,
      url: "https://example.com",
      status: "done",
      createdAt: "2024-01-01T00:00:00.000Z",
      extractors: ["warc"],
      archiveResults: [
        {
          id: 10,
          extractor: "warc",
          content: null,
          downloadUrl: "/api/v1/snapshots/1/archives/warc/download",
          previewUrl: null,
          createdAt: "2024-01-01T00:01:00Z",
        },
        {
          id: 11,
          extractor: "singlefile",
          content: null,
          downloadUrl: "/api/v1/snapshots/1/archives/singlefile/download",
          previewUrl: "/api/v1/snapshots/1/archives/singlefile/preview",
          createdAt: "2024-01-01T00:01:00Z",
        },
      ],
      screenshotUrl: "/api/v1/snapshots/1/archives/screenshot/download",
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(raw));

    const client = new WebFrostClient({ baseUrl: BASE });
    const result = await client.getSnapshot(1);

    expect(result).toEqual({
      id: 1,
      url: "https://example.com",
      status: "done",
      failure: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      extractors: ["warc"],
      tags: [],
      archiveResults: [
        {
          id: 10,
          extractor: "warc",
          content: null,
          downloadUrl: `${BASE}/api/v1/snapshots/1/archives/warc/download`,
          previewUrl: null,
          createdAt: "2024-01-01T00:01:00Z",
        },
        {
          id: 11,
          extractor: "singlefile",
          content: null,
          downloadUrl: `${BASE}/api/v1/snapshots/1/archives/singlefile/download`,
          previewUrl: `${BASE}/api/v1/snapshots/1/archives/singlefile/preview`,
          createdAt: "2024-01-01T00:01:00Z",
        },
      ],
      title: null,
      excerpt: null,
      screenshotUrl: `${BASE}/api/v1/snapshots/1/archives/screenshot/download`,
      extractorMeta: {},
    });
    expect((fetchSpy.mock.calls[0] as unknown[])[0]).toBe(`${BASE}/api/v1/snapshots/1`);
  });

  test("returns null on 404", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 404 }));

    const client = new WebFrostClient({ baseUrl: BASE });
    const result = await client.getSnapshot(999);

    expect(result).toBeNull();
  });

  test("throws WebFrostError on 500", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 500, statusText: "Oops" }));

    const client = new WebFrostClient({ baseUrl: BASE });
    await expect(client.getSnapshot(1)).rejects.toBeInstanceOf(WebFrostError);
  });
});

describe("WebFrostClient snapshot filters", () => {
  /** The query string the client sent on its only request. */
  function sentParams(): URLSearchParams {
    return new URL((fetchSpy.mock.calls[0] as unknown[])[0] as string).searchParams;
  }

  test("listSnapshots sends every filter to the server", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ items: [], total: 0, page: 1, limit: 20 }));
    const client = new WebFrostClient({ baseUrl: BASE });
    await client.listSnapshots({
      status: ["done", "failed"],
      since: "2026-11-01",
      before: new Date("2026-12-01T00:00:00Z"),
      extractors: ["pdf", "warc"],
      tags: [3, 7],
      contains: "  example.com/docs  ",
    });

    expect(Object.fromEntries(sentParams())).toEqual({
      status: "done,failed",
      since: "2026-11-01",
      before: "2026-12-01T00:00:00.000Z",
      extractor: "pdf,warc",
      tag: "3,7",
      contains: "example.com/docs",
    });
  });

  test("empty filters send nothing", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ items: [], total: 0, page: 1, limit: 20 }));
    const client = new WebFrostClient({ baseUrl: BASE });
    await client.listSnapshots({ status: [], extractors: [], tags: [], contains: "   " });

    expect((fetchSpy.mock.calls[0] as unknown[])[0]).toBe(`${BASE}/api/v1/snapshots`);
  });

  test("searchSnapshotsPage sends the filters with the query", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ items: [], total: 0, page: 2, limit: 20 }));
    const client = new WebFrostClient({ baseUrl: BASE });
    await client.searchSnapshotsPage("glacier", {
      page: 2,
      status: "done",
      since: "2026-11-01",
      extractors: ["pdf"],
      tags: [3],
    });

    expect(Object.fromEntries(sentParams())).toEqual({
      q: "glacier",
      page: "2",
      status: "done",
      since: "2026-11-01",
      extractor: "pdf",
      tag: "3",
    });
  });

  test("iterateSnapshots keeps the filters on every page", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ items: [], total: 0, page: 1, limit: 100 }));
    const client = new WebFrostClient({ baseUrl: BASE });
    for await (const _ of client.iterateSnapshots({ contains: "example", tags: [3] })) {
      // no items
    }

    expect(sentParams().get("contains")).toBe("example");
    expect(sentParams().get("tag")).toBe("3");
  });
});

describe("WebFrostClient.searchSnapshotsPage", () => {
  const hit = {
    id: 1,
    url: "https://a.com",
    snippet: "hello <mark>world</mark>",
    rank: -1.5,
    status: "done",
    createdAt: "2024-01-01T00:00:00.000Z",
    title: "A",
    extractors: ["readability"],
    tags: [{ id: 2, name: "x", slug: "x", color: null, createdAt: "2024-01-01T00:00:00.000Z" }],
  };

  test("sends q/page/limit and returns total", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ items: [hit], total: 42, page: 3, limit: 10 }));
    const client = new WebFrostClient({ baseUrl: BASE });
    const result = await client.searchSnapshotsPage("a b", { page: 3, limit: 10 });

    const calledUrl = (fetchSpy.mock.calls[0] as unknown[])[0] as string;
    const params = new URL(calledUrl).searchParams;
    expect(params.get("q")).toBe("a b");
    expect(params.get("page")).toBe("3");
    expect(params.get("limit")).toBe("10");
    expect(result.total).toBe(42);
    expect(result.page).toBe(3);
    expect(result.limit).toBe(10);
    expect(result.items[0]?.title).toBe("A");
    expect(result.items[0]?.tags[0]?.slug).toBe("x");
    expect(result.items[0]?.extractors).toEqual(["readability"]);
  });

  test("fills defaults for hits without summary fields", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        items: [{ id: 1, url: "u", snippet: "s", rank: 0 }],
        total: 1,
        page: 1,
        limit: 20,
      }),
    );
    const client = new WebFrostClient({ baseUrl: BASE });
    const result = await client.searchSnapshotsPage("q");
    expect(result.items[0]).toMatchObject({ status: null, title: null, extractors: [], tags: [] });
    expect(result.total).toBe(1);
  });

  test("searchSnapshots still returns an array", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ items: [hit], total: 1, page: 1, limit: 20 }));
    const client = new WebFrostClient({ baseUrl: BASE });
    const result = await client.searchSnapshots("q");
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]?.id).toBe(1);
  });
});

describe("WebFrostError.retryAfter", () => {
  test("parsed from Retry-After header on 429", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "slow down" }), {
        status: 429,
        headers: { "Retry-After": "17" },
      }),
    );
    const client = new WebFrostClient({ baseUrl: BASE });
    let caught: unknown;
    try {
      await client.login("a", "b");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WebFrostError);
    expect((caught as WebFrostError).status).toBe(429);
    expect((caught as WebFrostError).retryAfter).toBe(17);
  });

  test("undefined without header and constructor stays compatible", async () => {
    expect(new WebFrostError(500, "x").retryAfter).toBeUndefined();
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 429 }));
    const client = new WebFrostClient({ baseUrl: BASE });
    const err = await client.listSnapshots().catch((e) => e);
    expect((err as WebFrostError).retryAfter).toBeUndefined();
  });
});

describe("WebFrostClient.getSetupStatus", () => {
  test("passes publicRead through", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ needsSetup: false, publicRead: true }));
    const client = new WebFrostClient({ baseUrl: BASE });
    expect(await client.getSetupStatus()).toEqual({
      needsSetup: false,
      publicRead: true,
      setupTokenRequired: false,
    });
    const [calledUrl] = fetchSpy.mock.calls[0] as [string];
    expect(calledUrl).toBe(`${BASE}/api/v1/setup/status`);
  });

  test("normalises missing publicRead/setupTokenRequired (older server) to false", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ needsSetup: true }));
    const client = new WebFrostClient({ baseUrl: BASE });
    expect(await client.getSetupStatus()).toEqual({
      needsSetup: true,
      publicRead: false,
      setupTokenRequired: false,
    });
  });

  test("passes setupTokenRequired through", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ needsSetup: true, setupTokenRequired: true }));
    const client = new WebFrostClient({ baseUrl: BASE });
    expect((await client.getSetupStatus()).setupTokenRequired).toBe(true);
  });
});

describe("WebFrostClient.completeSetup", () => {
  test("sends the setup token only when given", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ apiKey: "k" }));
    fetchSpy.mockResolvedValueOnce(jsonResponse({ apiKey: "k" }));
    const client = new WebFrostClient({ baseUrl: BASE });
    await client.completeSetup("admin", "password123");
    await client.completeSetup("admin", "password123", "tok");
    const bodies = (fetchSpy.mock.calls as unknown as [string, RequestInit][]).map((call) =>
      JSON.parse(String(call[1].body)),
    );
    expect(bodies[0]).toEqual({ username: "admin", password: "password123" });
    expect(bodies[1]).toEqual({ username: "admin", password: "password123", setupToken: "tok" });
  });
});

describe("baseUrl", () => {
  const created = { id: 1, url: "https://a.com", status: "pending" };

  test("is the server origin; the client adds /api/v1", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(created, 202));
    await new WebFrostClient({ baseUrl: "https://wf.example" }).createSnapshot("https://a.com");
    expect((fetchSpy.mock.calls[0] as unknown[])[0]).toBe("https://wf.example/api/v1/snapshots");
  });

  test("may carry a reverse-proxy path prefix", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(created, 202));
    await new WebFrostClient({ baseUrl: "https://example.com/webfrost/" }).createSnapshot("x");
    expect((fetchSpy.mock.calls[0] as unknown[])[0]).toBe(
      "https://example.com/webfrost/api/v1/snapshots",
    );
  });

  test("defaults to the page's own origin", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(created, 202));
    await new WebFrostClient().createSnapshot("https://a.com");
    expect((fetchSpy.mock.calls[0] as unknown[])[0]).toBe("/api/v1/snapshots");
  });

  test("a legacy value ending in /api is normalised, with one warning", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      fetchSpy.mockImplementation(async () => jsonResponse(created, 202));
      await new WebFrostClient({ baseUrl: "http://localhost:3000/api" }).createSnapshot("x");
      await new WebFrostClient({ baseUrl: "http://localhost:3000/api/" }).createSnapshot("x");
      await new WebFrostClient({ baseUrl: "http://localhost:3000/api/v1" }).createSnapshot("x");
      for (const call of fetchSpy.mock.calls as unknown[][]) {
        expect(call[0]).toBe("http://localhost:3000/api/v1/snapshots");
      }
      // Warned at most once per process (another test may have triggered it already).
      expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("list envelopes", () => {
  const tag = { id: 1, name: "a", slug: "a", color: null, createdAt: "2026-01-01T00:00:00Z" };
  const envelope = (items: unknown[], extra: Record<string, number> = {}) =>
    jsonResponse({ items, total: items.length, page: 1, limit: 20, ...extra });

  test("every list method returns the page and sends page/limit", async () => {
    const client = new WebFrostClient({ baseUrl: BASE });
    const calls: Array<[() => Promise<{ items: unknown[]; total: number }>, string]> = [
      [() => client.listTags({ page: 2, limit: 5 }), "/api/v1/tags?page=2&limit=5"],
      [() => client.listSchedules({ page: 2, limit: 5 }), "/api/v1/schedules?page=2&limit=5"],
      [() => client.listApiKeys({ page: 2, limit: 5 }), "/api/v1/settings/keys?page=2&limit=5"],
      [() => client.listImports({ page: 2, limit: 5 }), "/api/v1/imports?page=2&limit=5"],
      [
        () => client.listSnapshotTags(7, { page: 2, limit: 5 }),
        "/api/v1/snapshots/7/tags?page=2&limit=5",
      ],
    ];
    for (const [call, path] of calls) {
      fetchSpy.mockResolvedValueOnce(envelope([tag]));
      const page = await call();
      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(1);
      expect((fetchSpy.mock.calls.at(-1) as unknown[])[0]).toBe(`${BASE}${path}`);
    }
  });

  test("iterateTags walks every page", async () => {
    fetchSpy
      .mockResolvedValueOnce(envelope([tag, tag], { total: 3, limit: 2 }))
      .mockResolvedValueOnce(jsonResponse({ items: [tag], total: 3, page: 2, limit: 2 }));
    const client = new WebFrostClient({ baseUrl: BASE });
    const all = [];
    for await (const t of client.iterateTags({ limit: 2 })) all.push(t);
    expect(all).toHaveLength(3);
    expect(fetchSpy.mock.calls).toHaveLength(2);
  });
});

describe("createApiKey", () => {
  test("sends expiresAt as ISO 8601 when given a Date", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ id: "k", name: "n", rawKey: "r" }, 201));
    await new WebFrostClient({ baseUrl: BASE }).createApiKey("n", {
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    });
    const init = (fetchSpy.mock.calls[0] as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toEqual({
      name: "n",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
  });
});

describe("WebFrostClient.retrySnapshot", () => {
  test("posts to the retry route and returns the body", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ id: 1, status: "pending" }, 202));

    const client = new WebFrostClient({ baseUrl: BASE });
    const result = await client.retrySnapshot(1);

    expect(result).toEqual({ id: 1, status: "pending" });
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`${BASE}/api/v1/snapshots/1/retry`);
    expect(calledInit.method).toBe("POST");
  });

  test("maps 409 to CONFLICT and 404 to NOT_FOUND", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ error: "snapshot is being archived", code: "CONFLICT" }, 409),
    );
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: "not found", code: "NOT_FOUND" }, 404));
    const client = new WebFrostClient({ baseUrl: BASE });

    const busy = await client.retrySnapshot(1).catch((e: unknown) => e);
    expect(busy).toBeInstanceOf(WebFrostError);
    expect((busy as WebFrostError).status).toBe(409);
    expect((busy as WebFrostError).code).toBe("CONFLICT");

    const missing = await client.retrySnapshot(2).catch((e: unknown) => e);
    expect((missing as WebFrostError).code).toBe("NOT_FOUND");
  });
});

describe("WebFrostClient.importSnapshot", () => {
  test("POSTs the bundle as application/zip with the API key and returns the new snapshot", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: 42, url: "https://video.example/watch", status: "done" }, 201),
    );
    const client = new WebFrostClient({ baseUrl: BASE, apiKey: "wf_secret" });
    const bundle = new Uint8Array([0x50, 0x4b, 0x05, 0x06]);
    const result = await client.importSnapshot(bundle);

    expect(result).toEqual({ id: 42, url: "https://video.example/watch", status: "done" });
    const [calledUrl, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`${BASE}/api/v1/snapshots/import`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(bundle);
    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toBe("application/zip");
    expect(headers.get("authorization")).toBe("Bearer wf_secret");
  });

  test("replaces names the failed snapshot it takes the place of", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: 43, url: "https://x.example", status: "done", replaced: 7 }, 201),
    );
    const client = new WebFrostClient({ baseUrl: BASE });
    const result = await client.importSnapshot(new Uint8Array([1]), { replaces: 7 });
    expect(result.replaced).toBe(7);
    const [calledUrl] = fetchSpy.mock.calls[0] as [string];
    expect(calledUrl).toBe(`${BASE}/api/v1/snapshots/import?replaces=7`);
  });

  test("streams a ReadableStream with its declared length, half duplex", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: 1, url: "https://x.example", status: "failed" }, 201),
    );
    const client = new WebFrostClient({ baseUrl: BASE });
    const stream = new Blob([new Uint8Array(10)]).stream();
    await client.importSnapshot(stream, { contentLength: 10 });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit & { duplex?: string }];
    expect(init.body).toBe(stream);
    expect(init.duplex).toBe("half");
    expect(new Headers(init.headers).get("content-length")).toBe("10");
  });

  test("a rejected bundle surfaces the server's error, and is never retried", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(
        { error: "invalid manifest: unknown field manifest.x", code: "VALIDATION" },
        400,
      ),
    );
    const client = new WebFrostClient({ baseUrl: BASE, retries: 3 });
    const err = (await client
      .importSnapshot(new Blob(["x"]))
      .catch((e: unknown) => e)) as WebFrostError;
    expect(err).toBeInstanceOf(WebFrostError);
    expect(err.status).toBe(400);
    expect(err.code).toBe("VALIDATION");
    expect(err.message).toBe("invalid manifest: unknown field manifest.x");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("has no timeout by default, unlike other requests", async () => {
    fetchSpy.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          setTimeout(
            () => resolve(jsonResponse({ id: 1, url: "https://x.example", status: "done" }, 201)),
            60,
          );
        }),
    );
    const client = new WebFrostClient({ baseUrl: BASE, timeoutMs: 20 });
    expect((await client.importSnapshot(new Blob(["x"]))).id).toBe(1);
    const timedOut = (await client
      .importSnapshot(new Blob(["x"]), { timeoutMs: 10 })
      .catch((e: unknown) => e)) as WebFrostError;
    expect(timedOut.code).toBe("TIMEOUT");
  });
});

describe("WebFrostClient failures", () => {
  test("a failed snapshot carries its failure; an older server's answer maps to null", async () => {
    const failure = {
      category: "domain_not_found",
      class: "permanent",
      label: "Domain does not exist",
      detail: "getaddrinfo ENOTFOUND gone.example",
    } as const;
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            id: 1,
            url: "https://gone.example",
            status: "failed",
            failure,
            createdAt: "2024-01-01T00:00:00Z",
          },
          {
            id: 2,
            url: "https://old.example",
            status: "failed",
            createdAt: "2024-01-01T00:00:00Z",
          },
        ],
        total: 2,
        page: 1,
        limit: 20,
      }),
    );
    const page = await new WebFrostClient({ baseUrl: BASE }).listSnapshots();
    expect(page.items.map((s) => s.failure)).toEqual([failure, null]);
  });

  test("listFailureDomains passes the filter and trashFailures posts the selection", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ items: [], total: 0, snapshots: 0, page: 2, limit: 50 }),
    );
    fetchSpy.mockResolvedValueOnce(jsonResponse({ trashed: 3, ids: [4, 5, 6] }));
    const client = new WebFrostClient({ baseUrl: BASE });

    await client.listFailureDomains("domain-gone", { q: "mirror site", page: 2 });
    const asked = new URL(String(fetchSpy.mock.calls[0]?.[0]));
    expect(asked.pathname).toBe("/api/v1/failures/domain-gone/domains");
    expect(Object.fromEntries(asked.searchParams)).toEqual({ q: "mirror site", page: "2" });
    expect(await client.trashFailures("domain-gone", { hosts: ["gone.example"] })).toEqual({
      trashed: 3,
      ids: [4, 5, 6],
    });
    const [url, init] = fetchSpy.mock.calls[1] ?? [];
    expect(String(url)).toBe(`${BASE}/api/v1/failures/domain-gone/trash`);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ hosts: ["gone.example"] });
  });
});

describe("WebFrostClient: connecting a command line", () => {
  test("startDeviceAuthorization asks without credentials and returns the codes", async () => {
    const started = {
      deviceCode: "d".repeat(64),
      userCode: "WDJB-MJHT",
      expiresIn: 600,
      interval: 2,
      verificationPath: "/#/connect",
      verificationPathComplete: "/#/connect?code=WDJB-MJHT",
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(started));
    const client = new WebFrostClient({ baseUrl: BASE });
    expect(await client.startDeviceAuthorization({ name: "laptop" })).toEqual(started);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/v1/auth/device`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ name: "laptop" });
  });

  test("pollDeviceAuthorization reports pending, approved with the key, and a gone request as expired", async () => {
    const client = new WebFrostClient({ baseUrl: BASE });
    fetchSpy.mockResolvedValueOnce(jsonResponse({ status: "pending" }));
    expect(await client.pollDeviceAuthorization("abc")).toEqual({ status: "pending" });
    expect(JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual(
      { deviceCode: "abc" },
    );

    const key = { id: "k1", name: "laptop", expiresAt: null, lastUsedAt: null, createdAt: "x" };
    fetchSpy.mockResolvedValueOnce(jsonResponse({ status: "approved", apiKey: "secret", key }));
    expect(await client.pollDeviceAuthorization("abc")).toEqual({
      status: "approved",
      apiKey: "secret",
      key,
    });

    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ error: "unknown or expired connection request", code: "NOT_FOUND" }, 404),
    );
    expect(await client.pollDeviceAuthorization("abc")).toEqual({ status: "expired" });
  });

  test("getDeviceRequest is null for an unknown code; approve and deny say whether they applied", async () => {
    const client = new WebFrostClient({ baseUrl: BASE });
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: "x", code: "NOT_FOUND" }, 404));
    expect(await client.getDeviceRequest("WDJB MJHT")).toBeNull();
    expect((fetchSpy.mock.calls[0] as [string])[0]).toBe(
      `${BASE}/api/v1/auth/device/requests/WDJB%20MJHT`,
    );

    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));
    expect(await client.approveDeviceRequest("WDJB-MJHT")).toBe(true);
    const [url, init] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/v1/auth/device/requests/WDJB-MJHT/approve`);
    expect(init.method).toBe("POST");

    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: "x", code: "NOT_FOUND" }, 404));
    expect(await client.denyDeviceRequest("WDJB-MJHT")).toBe(false);
    expect((fetchSpy.mock.calls[2] as [string])[0]).toBe(
      `${BASE}/api/v1/auth/device/requests/WDJB-MJHT/deny`,
    );
  });
});

describe("WebFrostClient: blank searches and a reused signal", () => {
  test("a blank query is not sent: it is an empty result, not the plain list", async () => {
    const client = new WebFrostClient({ baseUrl: BASE });
    expect(await client.searchSnapshots("   ")).toEqual([]);
    expect(await client.searchSnapshotsPage("", { page: 2 })).toEqual({
      items: [],
      total: 0,
      page: 2,
      limit: 20,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a result without snippet or rank still has a string and a number", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ items: [{ id: 1, url: "https://a.com" }], total: 1, page: 1, limit: 20 }),
    );
    const [hit] = await new WebFrostClient({ baseUrl: BASE }).searchSnapshots("a");
    expect(hit?.snippet).toBe("");
    expect(hit?.rank).toBe(0);
  });

  test("one signal for many requests, failed ones included, collects no listeners", async () => {
    const controller = new AbortController();
    const added: unknown[] = [];
    const original = controller.signal.addEventListener.bind(controller.signal);
    controller.signal.addEventListener = ((
      ...args: Parameters<AbortSignal["addEventListener"]>
    ) => {
      added.push(args[0]);
      return original(...args);
    }) as AbortSignal["addEventListener"];
    const client = new WebFrostClient({ baseUrl: BASE });
    for (let i = 0; i < 5; i++) {
      fetchSpy.mockResolvedValueOnce(new Response("nope", { status: 500 }));
      await client.downloadArchive(1, "pdf", { signal: controller.signal }).catch(() => {});
    }
    expect(added).toEqual([]);
  });
});
