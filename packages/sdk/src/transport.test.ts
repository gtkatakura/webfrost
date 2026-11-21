import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { WebFrostClient, WebFrostError } from "./client";

// A real local server, so timeouts, aborts, redirects and multipart bodies behave as they do
// against WebFrost rather than as a mock says they do.
type Handler = (req: Request) => Response | Promise<Response>;
let handler: Handler = () => new Response("unset", { status: 500 });
let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: (req) => handler(req) });
  base = `http://localhost:${server.port}/api`;
});
afterAll(() => server.stop(true));
afterEach(() => {
  handler = () => new Response("unset", { status: 500 });
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });

async function caught(p: Promise<unknown>): Promise<WebFrostError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(WebFrostError);
    return err as WebFrostError;
  }
  throw new Error("expected the call to throw");
}

const raw = (id: number) => ({
  id,
  url: `https://example.com/${id}`,
  status: "done",
  createdAt: "2026-01-01T00:00:00.000Z",
  extractors: [],
  tags: [],
  title: null,
  excerpt: null,
  screenshotUrl: null,
});

describe("error parsing", () => {
  test("surfaces the server's error and code", async () => {
    handler = () => json({ error: "invalid url", code: "VALIDATION" }, 400);
    const err = await caught(new WebFrostClient({ baseUrl: base }).createSnapshot("x"));
    expect(err.status).toBe(400);
    expect(err.message).toBe("invalid url");
    expect(err.code).toBe("VALIDATION");
  });

  test("every method uses it, GETs included", async () => {
    handler = () => json({ error: "nope", code: "FORBIDDEN" }, 403);
    const err = await caught(new WebFrostClient({ baseUrl: base }).getStats());
    expect(err.message).toBe("nope");
    expect(err.code).toBe("FORBIDDEN");
  });

  test("derives a code from the status when the server sent none", async () => {
    handler = () => json({ error: "old server" }, 409);
    const err = await caught(new WebFrostClient({ baseUrl: base }).createTag("a"));
    expect(err.code).toBe("CONFLICT");
  });

  test("falls back to the status text for a non-JSON body", async () => {
    handler = () =>
      new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" });
    const err = await caught(new WebFrostClient({ baseUrl: base }).getStats());
    expect(err.status).toBe(502);
    expect(err.message).toBe("Bad Gateway");
    expect(err.code).toBe("INTERNAL");
  });

  test("keeps retryAfter", async () => {
    handler = () => json({ error: "slow down", code: "RATE_LIMITED" }, 429, { "Retry-After": "7" });
    const err = await caught(new WebFrostClient({ baseUrl: base }).getStats());
    expect(err.retryAfter).toBe(7);
    expect(err.code).toBe("RATE_LIMITED");
  });
});

describe("network errors and timeouts", () => {
  test("a refused connection is a WebFrostError, not a TypeError", async () => {
    const dead = Bun.serve({ port: 0, fetch: () => new Response("x") });
    const url = `http://localhost:${dead.port}/api`;
    dead.stop(true);
    const err = await caught(new WebFrostClient({ baseUrl: url }).getStats());
    expect(err.status).toBe(0);
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.cause).toBeDefined();
  });

  test("times out", async () => {
    handler = async () => {
      await Bun.sleep(300);
      return json({});
    };
    const started = Date.now();
    const err = await caught(new WebFrostClient({ baseUrl: base, timeoutMs: 50 }).getStats());
    expect(err.code).toBe("TIMEOUT");
    expect(err.status).toBe(0);
    expect(Date.now() - started).toBeLessThan(250);
  });

  test("the timeout covers a body that stalls after the headers", async () => {
    handler = () =>
      new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode("{"));
            await Bun.sleep(300);
            controller.close();
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    const err = await caught(new WebFrostClient({ baseUrl: base, timeoutMs: 50 }).getStats());
    expect(err.code).toBe("TIMEOUT");
  });

  test("timeoutMs: 0 disables the timeout", async () => {
    handler = async () => {
      await Bun.sleep(100);
      return json({ snapshotCount: 1 });
    };
    const stats = await new WebFrostClient({ baseUrl: base, timeoutMs: 0 }).getStats();
    expect(stats.snapshotCount).toBe(1);
  });

  test("an invalid JSON body is INVALID_RESPONSE", async () => {
    handler = () => new Response("not json", { status: 200 });
    const err = await caught(new WebFrostClient({ baseUrl: base }).getStats());
    expect(err.code).toBe("INVALID_RESPONSE");
  });
});

describe("abort signals", () => {
  test("aborting mid-request rejects with ABORTED", async () => {
    handler = async () => {
      await Bun.sleep(300);
      return json({});
    };
    const controller = new AbortController();
    const pending = new WebFrostClient({ baseUrl: base }).getStats({ signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    const err = await caught(pending);
    expect(err.code).toBe("ABORTED");
  });

  test("an already-aborted signal never sends the request", async () => {
    let hits = 0;
    handler = () => {
      hits++;
      return json({});
    };
    const controller = new AbortController();
    controller.abort();
    const err = await caught(
      new WebFrostClient({ baseUrl: base }).listSnapshots({}, { signal: controller.signal }),
    );
    expect(err.code).toBe("ABORTED");
    expect(hits).toBe(0);
  });

  test("an abort wins over the timeout when it comes first", async () => {
    handler = async () => {
      await Bun.sleep(300);
      return json({});
    };
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const err = await caught(
      new WebFrostClient({ baseUrl: base, timeoutMs: 5000 }).createSnapshot("https://a.com", {
        signal: controller.signal,
      }),
    );
    expect(err.code).toBe("ABORTED");
  });

  test("aborting during a retry backoff stops the retries", async () => {
    let hits = 0;
    handler = () => {
      hits++;
      return json({ error: "down" }, 503);
    };
    const controller = new AbortController();
    const client = new WebFrostClient({ baseUrl: base, retries: 5, retryDelayMs: 5000 });
    const pending = client.getStats({ signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    const err = await caught(pending);
    expect(err.code).toBe("ABORTED");
    expect(hits).toBe(1);
  });
});

describe("retries", () => {
  test("GET retries 503 and then succeeds", async () => {
    let hits = 0;
    handler = () => {
      hits++;
      return hits < 3 ? json({ error: "busy" }, 503) : json({ snapshotCount: 4 });
    };
    const client = new WebFrostClient({ baseUrl: base, retries: 3, retryDelayMs: 1 });
    expect((await client.getStats()).snapshotCount).toBe(4);
    expect(hits).toBe(3);
  });

  test("gives up after `retries` and throws the last error", async () => {
    let hits = 0;
    handler = () => {
      hits++;
      return json({ error: "busy", code: "INTERNAL" }, 502);
    };
    const client = new WebFrostClient({ baseUrl: base, retries: 2, retryDelayMs: 1 });
    const err = await caught(client.getStats());
    expect(err.status).toBe(502);
    expect(hits).toBe(3);
  });

  test("does not retry by default", async () => {
    let hits = 0;
    handler = () => {
      hits++;
      return json({ error: "busy" }, 503);
    };
    await caught(new WebFrostClient({ baseUrl: base }).getStats());
    expect(hits).toBe(1);
  });

  test("does not retry client errors", async () => {
    let hits = 0;
    handler = () => {
      hits++;
      return json({ error: "no" }, 401);
    };
    await caught(new WebFrostClient({ baseUrl: base, retries: 3, retryDelayMs: 1 }).getStats());
    expect(hits).toBe(1);
  });

  test("never retries POST, PATCH or DELETE", async () => {
    let hits = 0;
    handler = () => {
      hits++;
      return json({ error: "busy" }, 503);
    };
    const client = new WebFrostClient({ baseUrl: base, retries: 3, retryDelayMs: 1 });
    await caught(client.createSnapshot("https://a.com"));
    await caught(client.updateSchedule(1, { paused: true }));
    await caught(client.deleteSnapshot(1));
    expect(hits).toBe(3);
  });

  test("honours Retry-After on 429", async () => {
    let hits = 0;
    const times: number[] = [];
    handler = () => {
      times.push(Date.now());
      hits++;
      return hits === 1
        ? json({ error: "slow", code: "RATE_LIMITED" }, 429, { "Retry-After": "1" })
        : json({ snapshotCount: 1 });
    };
    const client = new WebFrostClient({ baseUrl: base, retries: 1, retryDelayMs: 1 });
    await client.getStats();
    expect(hits).toBe(2);
    expect((times[1] ?? 0) - (times[0] ?? 0)).toBeGreaterThanOrEqual(950);
  });

  test("does not wait out a Retry-After longer than maxRetryDelayMs", async () => {
    let hits = 0;
    handler = () => {
      hits++;
      return json({ error: "slow" }, 429, { "Retry-After": "120" });
    };
    const client = new WebFrostClient({ baseUrl: base, retries: 3, maxRetryDelayMs: 1000 });
    const err = await caught(client.getStats());
    expect(err.status).toBe(429);
    expect(err.retryAfter).toBe(120);
    expect(hits).toBe(1);
  });

  test("retries network errors and timeouts", async () => {
    let calls = 0;
    const flaky = (async () => {
      calls++;
      if (calls === 1) throw new TypeError("fetch failed");
      return json({ snapshotCount: 2 });
    }) as unknown as typeof fetch;
    const client = new WebFrostClient({
      baseUrl: base,
      fetch: flaky,
      retries: 2,
      retryDelayMs: 1,
    });
    expect((await client.getStats()).snapshotCount).toBe(2);
    expect(calls).toBe(2);

    let slowHits = 0;
    handler = async () => {
      slowHits++;
      if (slowHits === 1) await Bun.sleep(300);
      return json({ snapshotCount: 3 });
    };
    const impatient = new WebFrostClient({
      baseUrl: base,
      timeoutMs: 50,
      retries: 1,
      retryDelayMs: 1,
    });
    expect((await impatient.getStats()).snapshotCount).toBe(3);
  });

  test("backs off exponentially with jitter", async () => {
    const random = spyOn(Math, "random").mockReturnValue(0); // lowest jitter: 50% of the delay
    try {
      const times: number[] = [];
      handler = () => {
        times.push(Date.now());
        return json({ error: "busy" }, 503);
      };
      const client = new WebFrostClient({ baseUrl: base, retries: 3, retryDelayMs: 40 });
      await caught(client.getStats());
      const gaps = times.slice(1).map((t, i) => t - (times[i] ?? 0));
      // Delays 40, 80, 160 ms at 50% jitter: 20, 40, 80 ms minimum.
      expect(gaps[0]).toBeGreaterThanOrEqual(18);
      expect(gaps[1]).toBeGreaterThanOrEqual(38);
      expect(gaps[2]).toBeGreaterThanOrEqual(78);
    } finally {
      random.mockRestore();
    }
  });
});

describe("client options", () => {
  test("uses a custom fetch and sends the API key", async () => {
    const seen: { url: string; auth: string | null; credentials?: RequestCredentials }[] = [];
    const custom = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({
        url: String(url),
        auth: new Headers(init?.headers).get("Authorization"),
        ...(init?.credentials ? { credentials: init.credentials } : {}),
      });
      return json({ username: null });
    }) as unknown as typeof fetch;
    const client = new WebFrostClient({
      baseUrl: "http://example.test/api/",
      apiKey: "k_123",
      fetch: custom,
    });
    await client.getMe();
    expect(seen).toEqual([
      { url: "http://example.test/api/auth/me", auth: "Bearer k_123", credentials: "same-origin" },
    ]);
  });

  test("passes the credentials option through", async () => {
    let seen: RequestCredentials | undefined;
    const custom = (async (_url: string, init?: RequestInit) => {
      seen = init?.credentials;
      return json({ ok: true });
    }) as unknown as typeof fetch;
    await new WebFrostClient({ baseUrl: base, fetch: custom, credentials: "include" }).login(
      "a",
      "b",
    );
    expect(seen).toBe("include");
  });

  test("looks up the global fetch on every call", async () => {
    handler = () => json({ snapshotCount: 1 });
    const client = new WebFrostClient({ baseUrl: base });
    const original = globalThis.fetch;
    let replaced = 0;
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      replaced++;
      return original(...args);
    }) as typeof fetch;
    try {
      await client.getStats();
    } finally {
      globalThis.fetch = original;
    }
    expect(replaced).toBe(1);
  });
});

describe("not-found semantics", () => {
  test("getSnapshot resolves null, deletes resolve false, tag listing resolves []", async () => {
    handler = () => json({ error: "not found", code: "NOT_FOUND" }, 404);
    const client = new WebFrostClient({ baseUrl: base });
    expect(await client.getSnapshot(9)).toBeNull();
    expect(await client.deleteSnapshot(9)).toBe(false);
    expect(await client.deleteTag(9)).toBe(false);
    expect(await client.deleteSchedule(9)).toBe(false);
    expect(await client.revokeApiKey("x")).toBe(false);
    expect(await client.removeTagFromSnapshot(9, 1)).toBe(false);
    expect(await client.listSnapshotTags(9)).toEqual([]);
  });

  test("anything else throws NOT_FOUND", async () => {
    handler = () => json({ error: "not found", code: "NOT_FOUND" }, 404);
    const err = await caught(
      new WebFrostClient({ baseUrl: base }).updateSchedule(9, { paused: true }),
    );
    expect(err.code).toBe("NOT_FOUND");
  });

  test("a successful delete resolves true", async () => {
    handler = () => new Response(null, { status: 204 });
    expect(await new WebFrostClient({ baseUrl: base }).deleteTag(1)).toBe(true);
  });
});

describe("iterateSnapshots", () => {
  function paged(total: number, serverLimit?: number) {
    const requests: URL[] = [];
    handler = (req) => {
      const url = new URL(req.url);
      requests.push(url);
      const page = Number(url.searchParams.get("page"));
      const limit = Math.min(serverLimit ?? 1000, Number(url.searchParams.get("limit")));
      const start = (page - 1) * limit;
      const items = Array.from({ length: Math.max(0, Math.min(limit, total - start)) }, (_, i) =>
        raw(start + i + 1),
      );
      return json({ items, total, page, limit });
    };
    return requests;
  }

  test("walks every page in order", async () => {
    const requests = paged(5);
    const ids: number[] = [];
    for await (const s of new WebFrostClient({ baseUrl: base }).iterateSnapshots({ limit: 2 })) {
      ids.push(s.id);
    }
    expect(ids).toEqual([1, 2, 3, 4, 5]);
    expect(requests.map((u) => u.searchParams.get("page"))).toEqual(["1", "2", "3"]);
  });

  test("passes filters and defaults the limit to 100", async () => {
    const requests = paged(1);
    const out = [];
    for await (const s of new WebFrostClient({ baseUrl: base }).iterateSnapshots({
      status: "done",
    })) {
      out.push(s);
    }
    expect(out).toHaveLength(1);
    expect(requests[0]?.searchParams.get("status")).toBe("done");
    expect(requests[0]?.searchParams.get("limit")).toBe("100");
  });

  test("follows the limit the server applied when it caps the one requested", async () => {
    paged(7, 3);
    const ids: number[] = [];
    for await (const s of new WebFrostClient({ baseUrl: base }).iterateSnapshots({ limit: 50 })) {
      ids.push(s.id);
    }
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("is lazy: breaking out stops fetching", async () => {
    const requests = paged(100);
    for await (const s of new WebFrostClient({ baseUrl: base }).iterateSnapshots({ limit: 10 })) {
      if (s.id === 3) break;
    }
    expect(requests).toHaveLength(1);
  });

  test("an empty archive yields nothing", async () => {
    paged(0);
    const out = [];
    for await (const s of new WebFrostClient({ baseUrl: base }).iterateSnapshots()) out.push(s);
    expect(out).toEqual([]);
  });

  test("honours the signal", async () => {
    paged(100);
    const controller = new AbortController();
    const seen: number[] = [];
    const it = new WebFrostClient({ baseUrl: base }).iterateSnapshots({
      limit: 2,
      signal: controller.signal,
    });
    const err = await caught(
      (async () => {
        for await (const s of it) {
          seen.push(s.id);
          if (s.id === 2) controller.abort();
        }
      })(),
    );
    expect(err.code).toBe("ABORTED");
    expect(seen).toEqual([1, 2]);
  });
});

describe("importFile", () => {
  test("uploads multipart with the file, its name and the format", async () => {
    let seen:
      | { name: string; text: string; format: string | null; type: string | null }
      | undefined;
    handler = async (req) => {
      const form = await req.formData();
      const file = form.get("file") as File;
      seen = {
        name: file.name,
        text: await file.text(),
        format: form.get("format") as string | null,
        type: req.headers.get("content-type"),
      };
      return json({ queued: 2, skipped: 0, total: 2, format: "opml" }, 202);
    };
    const client = new WebFrostClient({ baseUrl: base });
    const result = await client.importFile(new Blob(["<opml/>"]), "opml", {
      filename: "feeds.opml",
    });
    expect(result).toEqual({ queued: 2, skipped: 0, total: 2, format: "opml" });
    expect(seen?.name).toBe("feeds.opml");
    expect(seen?.text).toBe("<opml/>");
    expect(seen?.format).toBe("opml");
    expect(seen?.type).toMatch(/^multipart\/form-data; boundary=/);
  });

  test("uses a File's own name and omits the format when not given", async () => {
    let name = "";
    let hasFormat = true;
    handler = async (req) => {
      const form = await req.formData();
      name = (form.get("file") as File).name;
      hasFormat = form.has("format");
      return json({ queued: 1, skipped: 0, total: 1, format: "text" }, 202);
    };
    await new WebFrostClient({ baseUrl: base }).importFile(new File(["https://a.com"], "urls.txt"));
    expect(name).toBe("urls.txt");
    expect(hasFormat).toBe(false);
  });

  test("surfaces a 413 with its code", async () => {
    handler = () => json({ error: "too big", code: "PAYLOAD_TOO_LARGE" }, 413);
    const err = await caught(new WebFrostClient({ baseUrl: base }).importFile(new Blob(["x"])));
    expect(err.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

describe("archives", () => {
  test("archiveUrl builds download and preview URLs", () => {
    const client = new WebFrostClient({ baseUrl: "https://wf.example/api/" });
    expect(client.archiveUrl(3, "singlefile")).toBe(
      "https://wf.example/api/snapshots/3/archives/singlefile/download",
    );
    expect(client.archiveUrl(3, "dom snapshot", "preview")).toBe(
      "https://wf.example/api/snapshots/3/archives/dom%20snapshot/preview",
    );
  });

  test("downloadArchive returns the Response, following redirects", async () => {
    handler = (req) => {
      const url = new URL(req.url);
      if (url.pathname.endsWith("/download")) {
        return new Response(null, { status: 302, headers: { Location: `${base}/blob` } });
      }
      return new Response("archived bytes", { headers: { "content-type": "text/html" } });
    };
    const res = await new WebFrostClient({ baseUrl: base }).downloadArchive(1, "singlefile");
    expect(res.ok).toBe(true);
    expect(await (await res.blob()).text()).toBe("archived bytes");
  });

  test("downloadArchive can ask for the preview", async () => {
    let path = "";
    handler = (req) => {
      path = new URL(req.url).pathname;
      return new Response("<p>hi</p>");
    };
    await new WebFrostClient({ baseUrl: base }).downloadArchive(1, "singlefile", {
      kind: "preview",
    });
    expect(path).toBe("/api/snapshots/1/archives/singlefile/preview");
  });

  test("downloadArchive throws NOT_FOUND for a missing result", async () => {
    handler = () => json({ error: "not found", code: "NOT_FOUND" }, 404);
    const err = await caught(new WebFrostClient({ baseUrl: base }).downloadArchive(1, "warc"));
    expect(err.code).toBe("NOT_FOUND");
  });

  test("the timeout ends at the headers, so a large body is not cut off", async () => {
    handler = () =>
      new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode("a"));
            await Bun.sleep(150);
            controller.enqueue(new TextEncoder().encode("b"));
            controller.close();
          },
        }),
      );
    const res = await new WebFrostClient({ baseUrl: base, timeoutMs: 50 }).downloadArchive(
      1,
      "warc",
    );
    expect(await res.text()).toBe("ab");
  });
});
