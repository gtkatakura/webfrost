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
    expect(fetchSpy).toHaveBeenCalledWith(`${BASE}/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
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
  test("returns array of snapshots", async () => {
    const raw = [
      {
        id: 1,
        url: "https://a.com",
        status: "done",
        createdAt: "2024-01-01T00:00:00.000Z",
        extractors: ["warc"],
        tags: [],
      },
      {
        id: 2,
        url: "https://b.com",
        status: "pending",
        createdAt: "2024-01-02T00:00:00.000Z",
        extractors: [],
        tags: [],
      },
    ];
    fetchSpy.mockResolvedValueOnce(jsonResponse(raw));

    const client = new WebFrostClient({ baseUrl: BASE });
    const result = await client.listSnapshots();

    expect(result).toEqual(raw);
    expect(fetchSpy).toHaveBeenCalledWith(`${BASE}/snapshots`);
  });

  test("throws WebFrostError on non-200", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 500, statusText: "Server Error" }));

    const client = new WebFrostClient({ baseUrl: BASE });
    await expect(client.listSnapshots()).rejects.toBeInstanceOf(WebFrostError);
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
    });
    expect(fetchSpy).toHaveBeenCalledWith(`${BASE}/snapshots/1`);
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
