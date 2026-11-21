import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { WebFrostClient, WebFrostError } from "./client";

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
    expect(calledUrl).toBe(`${BASE}/snapshots`);
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

  test("strips trailing slash from baseUrl", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: 2, url: "https://foo.com", status: "pending" }, 202),
    );

    const client = new WebFrostClient({ baseUrl: "http://localhost:3000/" });
    await client.createSnapshot("https://foo.com");

    expect((fetchSpy.mock.calls[0] as unknown[])[0]).toBe("http://localhost:3000/snapshots");
  });
});

describe("WebFrostClient.listSnapshots", () => {
  test("returns paginated result", async () => {
    const rawItems = [
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
    expect((fetchSpy.mock.calls[0] as unknown[])[0]).toBe(`${BASE}/snapshots`);
  });

  test("passes page and limit as query params", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ items: [], total: 0, page: 2, limit: 5 }));

    const client = new WebFrostClient({ baseUrl: BASE });
    await client.listSnapshots({ page: 2, limit: 5 });

    expect((fetchSpy.mock.calls[0] as unknown[])[0]).toBe(`${BASE}/snapshots?page=2&limit=5`);
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

    expect((fetchSpy.mock.calls[0] as unknown[])[0]).toBe(`${BASE}/snapshots?status=done`);
  });

  test("combines status with page and limit params", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ items: [], total: 0, page: 1, limit: 10 }));

    const client = new WebFrostClient({ baseUrl: BASE });
    await client.listSnapshots({ page: 1, limit: 10, status: "pending" });

    expect((fetchSpy.mock.calls[0] as unknown[])[0]).toBe(
      `${BASE}/snapshots?page=1&limit=10&status=pending`,
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
    expect(calledUrl).toBe(`${BASE}/schedules/1`);
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
        { id: 10, extractor: "warc", content: "data", created_at: "2024-01-01T00:01:00.000Z" },
      ],
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
        { id: 10, extractor: "warc", content: "data", createdAt: "2024-01-01T00:01:00.000Z" },
      ],
      title: null,
      excerpt: null,
      screenshotUrl: null,
      extractorMeta: {},
    });
    expect((fetchSpy.mock.calls[0] as unknown[])[0]).toBe(`${BASE}/snapshots/1`);
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

  test("fills defaults for legacy hits", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ items: [{ id: 1, url: "u", snippet: "s", rank: 0 }] }),
    );
    const client = new WebFrostClient({ baseUrl: BASE });
    const result = await client.searchSnapshotsPage("q");
    expect(result.items[0]).toMatchObject({ status: "", title: null, extractors: [], tags: [] });
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
    expect(await client.getSetupStatus()).toEqual({ needsSetup: false, publicRead: true });
    const [calledUrl] = fetchSpy.mock.calls[0] as [string];
    expect(calledUrl).toBe(`${BASE}/setup/status`);
  });

  test("normalises a missing publicRead (older server) to false", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ needsSetup: true }));
    const client = new WebFrostClient({ baseUrl: BASE });
    expect(await client.getSetupStatus()).toEqual({ needsSetup: true, publicRead: false });
  });
});
