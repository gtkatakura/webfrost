import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { sql } from "kysely";
import { type Db, openDb } from "../db";
import { FetchCache } from "../fetch-cache";
import { FilesystemBackend } from "../storage";
import { type WarcSource, warcDigest, warcExtractor } from "./warc";

let testDir: string;
let db: Db;

beforeEach(async () => {
  testDir = join(tmpdir(), `warc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  db = await openDb(testDir);
  // Insert a snapshot row to satisfy FK constraint
  await db.run(sql`INSERT INTO snapshots (url, status) VALUES ('https://example.com', 'pending')`);
});

afterEach(async () => {
  await db.close();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function makeStorage() {
  return new FilesystemBackend(join(testDir, "snapshots"));
}

function source(over: Partial<WarcSource> = {}): WarcSource {
  return {
    url: "https://example.com/",
    requestedUrl: "https://example.com/",
    status: 200,
    statusText: "OK",
    headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
    body: new TextEncoder().encode("<html><body>Hello WARC</body></html>"),
    redirects: [],
    ...over,
  };
}

// ── A small, strict WARC reader: every length and digest has to add up ──────

interface WarcRecord {
  headers: Map<string, string>;
  block: Uint8Array;
}

const decoder = new TextDecoder("latin1");

function indexOf(haystack: Uint8Array, needle: string, from: number): number {
  const n = new TextEncoder().encode(needle);
  outer: for (let i = from; i <= haystack.length - n.length; i++) {
    for (let j = 0; j < n.length; j++) if (haystack[i + j] !== n[j]) continue outer;
    return i;
  }
  return -1;
}

function parseHeaderLines(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\r\n")) {
    const colon = line.indexOf(":");
    expect(colon).toBeGreaterThan(0);
    out.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim());
  }
  return out;
}

function parseWarc(bytes: Uint8Array): WarcRecord[] {
  const records: WarcRecord[] = [];
  let pos = 0;
  while (pos < bytes.length) {
    const headEnd = indexOf(bytes, "\r\n\r\n", pos);
    expect(headEnd).toBeGreaterThan(pos);
    const head = decoder.decode(bytes.subarray(pos, headEnd));
    const [version, ...lines] = head.split("\r\n");
    expect(version).toBe("WARC/1.1");
    const headers = parseHeaderLines(lines.join("\r\n"));
    const length = Number(headers.get("content-length"));
    const blockStart = headEnd + 4;
    const block = bytes.subarray(blockStart, blockStart + length);
    expect(block.length).toBe(length);
    // Every record ends with exactly two CRLFs after the block.
    expect(decoder.decode(bytes.subarray(blockStart + length, blockStart + length + 4))).toBe(
      "\r\n\r\n",
    );
    expect(headers.get("warc-block-digest")).toBe(warcDigest(block));
    records.push({ headers, block });
    pos = blockStart + length + 4;
  }
  return records;
}

function parseHttp(block: Uint8Array): {
  statusLine: string;
  headers: Map<string, string>;
  body: Uint8Array;
} {
  const end = indexOf(block, "\r\n\r\n", 0);
  const [statusLine = "", ...lines] = decoder.decode(block.subarray(0, end)).split("\r\n");
  return {
    statusLine,
    headers: parseHeaderLines(lines.join("\r\n")),
    body: block.subarray(end + 4),
  };
}

function readWarc(): WarcRecord[] {
  const warcPath = join(testDir, "snapshots", "1", "archive.warc");
  expect(existsSync(warcPath)).toBe(true);
  return parseWarc(new Uint8Array(readFileSync(warcPath)));
}

/** The response records, checked for an HTTP block consistent with its headers. */
function responses(records: WarcRecord[]) {
  return records
    .filter((r) => r.headers.get("warc-type") === "response")
    .map((r) => {
      const http = parseHttp(r.block);
      expect(http.headers.has("transfer-encoding")).toBe(false);
      expect(Number(http.headers.get("content-length"))).toBe(http.body.length);
      expect(r.headers.get("warc-payload-digest")).toBe(warcDigest(http.body));
      return { record: r, ...http };
    });
}

describe("warcExtractor", () => {
  test("writes warcinfo, response and metadata records with valid lengths and digests", async () => {
    await warcExtractor(db, 1, source(), makeStorage());

    const records = readWarc();
    expect(records.map((r) => r.headers.get("warc-type"))).toEqual([
      "warcinfo",
      "response",
      "metadata",
    ]);
    const [res] = responses(records);
    expect(res?.statusLine).toBe("HTTP/1.1 200 OK");
    expect(res?.record.headers.get("warc-target-uri")).toBe("https://example.com/");
    expect(new TextDecoder().decode(res?.body)).toBe("<html><body>Hello WARC</body></html>");
  });

  test("digests are sha1 in base32", async () => {
    // sha1("abc") = a9993e364706816aba3e25717850c26c9cd0d89d
    expect(warcDigest(new TextEncoder().encode("abc"))).toBe(
      "sha1:VGMT4NSHA2AWVOR6EVYXQUGCNSONBWE5",
    );
  });

  test("stores WARC file ref in archive_results with extractor=warc", async () => {
    await warcExtractor(db, 1, source(), makeStorage());

    const row = await db.get<{ extractor: string; content: string }>(
      sql`SELECT extractor, content FROM archive_results WHERE snapshot_id = 1 LIMIT 1`,
    );

    expect(row?.extractor).toBe("warc");
    expect(row?.content).toContain("archive.warc");
  });

  test("rewrites Transfer-Encoding and Content-Length to match the stored body", async () => {
    const headers = new Headers({
      "content-type": "text/html",
      "transfer-encoding": "chunked",
      "content-length": "999",
    });
    await warcExtractor(db, 1, source({ headers }), makeStorage());
    // responses() asserts: no transfer-encoding, content-length = stored body length.
    expect(responses(readWarc())).toHaveLength(1);
  });

  test("keeps each Set-Cookie header on its own line", async () => {
    const headers = new Headers();
    headers.append("set-cookie", "a=1; Path=/");
    headers.append("set-cookie", "b=2; Path=/");
    await warcExtractor(db, 1, source({ headers }), makeStorage());
    const [res] = responses(readWarc());
    const head = decoder.decode(res?.record.block);
    expect(head).toContain("set-cookie: a=1; Path=/\r\nset-cookie: b=2; Path=/\r\n");
  });

  test("does not record a result after its signal was aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      warcExtractor(db, 1, source(), makeStorage(), controller.signal),
    ).rejects.toThrow();
    expect(await db.all(sql`SELECT * FROM archive_results`)).toHaveLength(0);
  });
});

// ── End to end: a real HTTP server, the fetch cache, the WARC on disk ─────────

const HTML = "<html><body><p>Glaciers remember.</p></body></html>";
const LATIN1_HTML =
  "<html><head><title>Café</title></head><body>Crème brûlée à la française</body></html>";
// A PNG signature and a few bytes that are not valid UTF-8.
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x80, 0xc3,
]);

let server: ReturnType<typeof Bun.serve>;
let base: string;
const saved = process.env.WEBFROST_ALLOW_PRIVATE_URLS;

beforeAll(async () => {
  process.env.WEBFROST_ALLOW_PRIVATE_URLS = "true";
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      switch (pathname) {
        case "/gzip":
          return new Response(gzipSync(HTML), {
            headers: { "content-type": "text/html; charset=utf-8", "content-encoding": "gzip" },
          });
        case "/image.png":
          return new Response(PNG, { headers: { "content-type": "image/png" } });
        case "/latin1":
          return new Response(Buffer.from(LATIN1_HTML, "latin1"), {
            headers: { "content-type": "text/html; charset=iso-8859-1" },
          });
        case "/latin1-meta":
          return new Response(
            Buffer.from(`<meta charset="windows-1252">${LATIN1_HTML}`, "latin1"),
            { headers: { "content-type": "text/html" } },
          );
        case "/old":
          return new Response(null, { status: 301, headers: { location: "/gzip" } });
        default:
          return new Response("nope", { status: 404 });
      }
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  server.stop(true);
  if (saved === undefined) Reflect.deleteProperty(process.env, "WEBFROST_ALLOW_PRIVATE_URLS");
  else process.env.WEBFROST_ALLOW_PRIVATE_URLS = saved;
});

async function archive(path: string) {
  const fetched = await new FetchCache().get(`${base}${path}`);
  await warcExtractor(db, 1, fetched, makeStorage());
  return { fetched, records: readWarc() };
}

describe("WARC from a live fetch", () => {
  test("a gzip response keeps its encoded body, consistent with Content-Encoding", async () => {
    const { fetched, records } = await archive("/gzip");
    const [res] = responses(records);
    expect(res?.headers.get("content-encoding")).toBe("gzip");
    expect(new TextDecoder().decode(gunzipSync(res?.body ?? new Uint8Array()))).toBe(HTML);
    // The text extractors get the decoded page.
    expect(fetched.html).toBe(HTML);
  });

  test("a binary response is stored byte for byte", async () => {
    const { fetched, records } = await archive("/image.png");
    const [res] = responses(records);
    expect(res?.headers.get("content-type")).toBe("image/png");
    expect([...(res?.body ?? [])]).toEqual([...PNG]);
    expect(fetched.isText).toBe(false);
    expect(fetched.html).toBe("");
  });

  test("a latin1 page keeps its bytes in the WARC and is decoded by its declared charset", async () => {
    const { fetched, records } = await archive("/latin1");
    const [res] = responses(records);
    expect([...(res?.body ?? [])]).toEqual([...Buffer.from(LATIN1_HTML, "latin1")]);
    expect(fetched.html).toBe(LATIN1_HTML);
  });

  test("falls back to <meta charset> when Content-Type has no charset", async () => {
    const fetched = await new FetchCache().get(`${base}/latin1-meta`);
    expect(fetched.html).toContain("Crème brûlée");
  });

  test("records the redirect and targets the final URL, keeping the requested one", async () => {
    const { fetched, records } = await archive("/old");
    expect(fetched.url).toBe(`${base}/gzip`);
    const res = responses(records);
    expect(res.map((r) => r.statusLine.split(" ")[1])).toEqual(["301", "200"]);
    expect(res[0]?.record.headers.get("warc-target-uri")).toBe(`${base}/old`);
    expect(res[1]?.record.headers.get("warc-target-uri")).toBe(`${base}/gzip`);

    const meta = records.find((r) => r.headers.get("warc-type") === "metadata");
    expect(meta?.headers.get("warc-concurrent-to")).toBe(
      res[1]?.record.headers.get("warc-record-id"),
    );
    expect(new TextDecoder().decode(meta?.block)).toContain(`requested-url: ${base}/old`);
  });
});
