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
