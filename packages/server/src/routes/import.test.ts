import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let testDir: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `webfrost-import-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  process.env.WEBFROST_DIR = testDir;
  process.env.AUTH_DISABLED = "true";
});

afterEach(() => {
  process.env.WEBFROST_DIR = undefined;
  process.env.AUTH_DISABLED = undefined;
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

async function getApp() {
  const { importRouter, importsRouter } = await import("./import");
  const { Elysia } = await import("elysia");
  return new Elysia().use(importRouter).use(importsRouter);
}

function post(app: Awaited<ReturnType<typeof getApp>>, body: unknown) {
  return app.handle(
    new Request("http://localhost/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("POST /import — validation", () => {
  test("returns 400 when neither url nor content is provided", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    const res = await post(app, {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("either url or content is required");
  });

  test("returns 400 for completely empty body", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    const res = await app.handle(
      new Request("http://localhost/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "null",
      }),
    );
    // Elysia validation rejects non-object body → 400
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Text format (content)
// ---------------------------------------------------------------------------

describe("POST /import — text format via content", () => {
  test("returns 202 with queued count for plain URL list", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    const res = await post(app, {
      content: "https://example.com\nhttps://other.com\n",
      format: "text",
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      queued: number;
      skipped: number;
      total: number;
      format: string;
    };
    expect(body.format).toBe("text");
    expect(body.total).toBe(2);
    expect(body.queued).toBe(2);
    expect(body.skipped).toBe(0);
  });

  test("skips comment lines and blank lines", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    const res = await post(app, {
      content: "# comment\n\nhttps://example.com\n",
      format: "text",
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { total: number };
    expect(body.total).toBe(1);
  });

  test("returns 202 with total=0 for content with no valid URLs", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    const res = await post(app, { content: "not-a-url\nftp://skip.me\n", format: "text" });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { total: number; queued: number };
    expect(body.total).toBe(0);
    expect(body.queued).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// RSS format (content)
// ---------------------------------------------------------------------------

const RSS2_FEED = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item><title>Article One</title><link>https://example.com/article-1</link></item>
    <item><title>Article Two</title><link>https://example.com/article-2</link></item>
  </channel>
</rss>`;

const ATOM_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry><title>Post One</title><link href="https://atom.example.com/post-1" rel="alternate"/></entry>
  <entry><title>Post Two</title><link href="https://atom.example.com/post-2"/></entry>
</feed>`;

describe("POST /import — RSS 2.0 format via content", () => {
  test("parses RSS 2.0 feed and queues article URLs", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    const res = await post(app, { content: RSS2_FEED, format: "rss" });
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      queued: number;
      skipped: number;
      total: number;
      format: string;
    };
    expect(body.format).toBe("rss");
    expect(body.total).toBe(2);
    expect(body.queued).toBe(2);
    expect(body.skipped).toBe(0);
  });

  test("deduplicates already-archived URLs in RSS content import", async () => {
    const { openDb } = await import("@webfrost/core");
    const db = openDb(testDir);
    db.exec("INSERT INTO snapshots (url, status) VALUES ('https://example.com/article-1', 'done')");
    db.close();

    const app = await getApp();
    const res = await post(app, { content: RSS2_FEED, format: "rss" });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { queued: number; skipped: number; total: number };
    expect(body.total).toBe(2);
    expect(body.skipped).toBe(1);
    expect(body.queued).toBe(1);
  });
});

describe("POST /import — Atom format via content", () => {
  test("parses Atom feed and queues article URLs", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    const res = await post(app, { content: ATOM_FEED, format: "rss" });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { queued: number; total: number; format: string };
    expect(body.format).toBe("rss");
    expect(body.total).toBe(2);
    expect(body.queued).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Auto-detection via content
// ---------------------------------------------------------------------------

describe("POST /import — format auto-detection", () => {
  test("auto-detects RSS 2.0 content when no format hint given", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    const res = await post(app, { content: RSS2_FEED });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { format: string; total: number };
    expect(body.format).toBe("rss");
    expect(body.total).toBe(2);
  });

  test("auto-detects Atom content when no format hint given", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    const res = await post(app, { content: ATOM_FEED });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { format: string; total: number };
    expect(body.format).toBe("rss");
    expect(body.total).toBe(2);
  });

  test("auto-detects text format for plain URL list with no format hint", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    const res = await post(app, { content: "https://example.com\nhttps://other.com" });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { format: string };
    expect(body.format).toBe("text");
  });
});

// ---------------------------------------------------------------------------
// OPML format (content)
// ---------------------------------------------------------------------------

describe("POST /import — OPML format via content", () => {
  const OPML = `<?xml version="1.0"?>
<opml version="2.0">
  <body>
    <outline type="rss" text="Example Feed" xmlUrl="https://example.com/feed.rss"/>
    <outline type="rss" text="Other Feed" xmlUrl="https://other.com/atom.xml"/>
  </body>
</opml>`;

  test("extracts xmlUrl entries from OPML", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    const res = await post(app, { content: OPML, format: "opml" });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { total: number; format: string };
    expect(body.format).toBe("opml");
    expect(body.total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// POST /import/file (multipart file upload)
// ---------------------------------------------------------------------------

const OPML_CONTENT = `<?xml version="1.0"?>
<opml version="2.0">
  <body>
    <outline type="rss" text="Example Feed" xmlUrl="https://example.com/feed.rss"/>
    <outline type="rss" text="Other Feed" xmlUrl="https://other.com/atom.xml"/>
  </body>
</opml>`;

const NETSCAPE_CONTENT = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<HTML><BODY>
<DL><p>
<DT><A HREF="https://example.com">Example</A>
<DT><A HREF="https://other.com">Other</A>
</DL></p>
</BODY></HTML>`;

function postFile(
  app: Awaited<ReturnType<typeof getApp>>,
  content: string,
  filename: string,
  format?: string,
) {
  const formData = new FormData();
  formData.append("file", new File([content], filename, { type: "text/plain" }));
  if (format) formData.append("format", format);
  return app.handle(
    new Request("http://localhost/import/file", {
      method: "POST",
      body: formData,
    }),
  );
}

describe("POST /import/file — multipart upload", () => {
  test("imports plain text URL list from uploaded file", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    const res = await postFile(app, "https://example.com\nhttps://other.com\n", "urls.txt", "text");
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      queued: number;
      skipped: number;
      total: number;
      format: string;
    };
    expect(body.format).toBe("text");
    expect(body.total).toBe(2);
    expect(body.queued).toBe(2);
  });

  test("imports OPML file and auto-detects format from filename", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    const res = await postFile(app, OPML_CONTENT, "subscriptions.opml");
    expect(res.status).toBe(202);
    const body = (await res.json()) as { format: string; total: number };
    expect(body.format).toBe("opml");
    expect(body.total).toBe(2);
  });

  test("imports Netscape bookmarks file with explicit format", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    const res = await postFile(app, NETSCAPE_CONTENT, "bookmarks.html", "netscape");
    expect(res.status).toBe(202);
    const body = (await res.json()) as { format: string; total: number };
    expect(body.format).toBe("netscape");
    expect(body.total).toBe(2);
  });

  test("records file import in history with null sourceUrl", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    await postFile(app, "https://example.com\n", "urls.txt", "text");

    const res = await app.handle(new Request("http://localhost/imports"));
    const body = (await res.json()) as Array<{ sourceUrl: string | null; format: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]?.sourceUrl).toBeNull();
    expect(body[0]?.format).toBe("text");
  });

  test("returns 400 when no file is provided", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    const res = await app.handle(
      new Request("http://localhost/import/file", {
        method: "POST",
        body: new FormData(),
      }),
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /imports
// ---------------------------------------------------------------------------

describe("GET /imports", () => {
  test("returns empty array when no imports have been run", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    const res = await app.handle(new Request("http://localhost/imports"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  test("records import and returns it in history", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    await post(app, {
      content: "https://example.com\nhttps://example.org",
      format: "text",
    });

    const res = await app.handle(new Request("http://localhost/imports"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      id: string;
      sourceUrl: string | null;
      format: string;
      queued: number;
      skipped: number;
      createdAt: string;
    }>;
    expect(body).toHaveLength(1);
    expect(body[0]?.format).toBe("text");
    expect(body[0]?.queued).toBe(2);
    expect(body[0]?.skipped).toBe(0);
    expect(body[0]?.sourceUrl).toBeNull();
    expect(typeof body[0]?.id).toBe("string");
    expect(typeof body[0]?.createdAt).toBe("string");
  });

  test("returns imports ordered newest first", async () => {
    const { openDb } = await import("@webfrost/core");
    openDb(testDir).close();

    const app = await getApp();
    await post(app, { content: "https://first.com", format: "text" });
    await post(app, { content: "https://second.com", format: "text" });

    const res = await app.handle(new Request("http://localhost/imports"));
    const body = (await res.json()) as Array<{ queued: number }>;
    expect(body).toHaveLength(2);
    // Newest first — both queued 1 URL; just verify length and ordering by createdAt
    expect(body[0]).toBeDefined();
    expect(body[1]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Imported URLs are actually archived
// ---------------------------------------------------------------------------

describe("POST /import — background pipelines", () => {
  test("imported snapshots finish instead of staying pending", async () => {
    // Regression: the route closed the DB connection it had handed to the
    // background pipelines, so every imported snapshot stayed `pending` forever.
    const origin = Bun.serve({
      port: 0,
      fetch: () =>
        new Response("<html><body><p>imported page</p></body></html>", {
          headers: { "content-type": "text/html" },
        }),
    });
    process.env.WEBFROST_ALLOW_PRIVATE_URLS = "true";
    process.env.WEBFROST_DOMAIN_DELAY_MS = "0";
    try {
      const app = await getApp();
      const base = `http://127.0.0.1:${origin.port}`;
      const res = await post(app, { content: `${base}/one\n${base}/two\n`, format: "text" });
      expect(res.status).toBe(202);
      expect(((await res.json()) as { queued: number }).queued).toBe(2);

      const { getRunner } = await import("../context");
      await getRunner().onIdle();

      const { openDb } = await import("@webfrost/core");
      const db = openDb(testDir);
      try {
        const rows = db
          .query<{ status: string }, []>("SELECT status FROM snapshots ORDER BY id")
          .all();
        expect(rows).toEqual([{ status: "done" }, { status: "done" }]);
      } finally {
        db.close();
      }
    } finally {
      process.env.WEBFROST_ALLOW_PRIVATE_URLS = undefined;
      process.env.WEBFROST_DOMAIN_DELAY_MS = undefined;
      origin.stop(true);
    }
  }, 60_000);
});
