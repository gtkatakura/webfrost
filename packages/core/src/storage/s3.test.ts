/**
 * S3Backend unit tests — use a mock HTTP server to simulate an S3-compatible
 * endpoint without requiring a real MinIO or AWS instance.
 *
 * All tests run against an in-process Bun HTTP server that records requests and
 * returns pre-canned responses. This avoids any external network dependency.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { S3Backend, validateS3Ref } from "./s3";

const BUCKET = "webfrost";
const ACCESS_KEY = "testkey";
const SECRET_KEY = "testsecret";
const REGION = "us-east-1";

interface CapturedRequest {
  method: string;
  path: string;
  body: string;
  headers: Record<string, string>;
}

interface MockServer {
  port: number;
  stop(): void;
  /** Response factory — return null to use the default 200 OK. */
  setHandler(fn: (req: CapturedRequest) => Response | null): void;
  lastRequest(): CapturedRequest | undefined;
  requests(): CapturedRequest[];
}

/** Start a lightweight mock S3 HTTP server. Returns control handles. */
function startMockS3(): MockServer {
  const captured: CapturedRequest[] = [];
  let handler: ((req: CapturedRequest) => Response | null) | null = null;

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.text();
      const url = new URL(req.url);
      const captured_req: CapturedRequest = {
        method: req.method,
        path: url.pathname + (url.search ? url.search : ""),
        body,
        headers: Object.fromEntries(req.headers.entries()),
      };
      captured.push(captured_req);

      if (handler) {
        const resp = handler(captured_req);
        if (resp) return resp;
      }

      // Default responses for standard S3 operations
      if (req.method === "PUT") {
        return new Response(null, { status: 200 });
      }
      if (req.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "content-length": "42" },
        });
      }
      if (req.method === "GET" && url.search.includes("list-type")) {
        // ListObjectsV2 default response
        const xml = `<?xml version="1.0"?>
<ListBucketResult>
  <Contents><Key>snapshots/1/archive.warc</Key></Contents>
  <Contents><Key>snapshots/1/dom.html</Key></Contents>
</ListBucketResult>`;
        return new Response(xml, { headers: { "content-type": "application/xml" } });
      }
      if (req.method === "GET") {
        return new Response("file-content", { status: 200 });
      }
      if (req.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return new Response("not found", { status: 404 });
    },
  });

  return {
    port: server.port ?? 0,
    stop() {
      server.stop(true);
    },
    setHandler(fn) {
      handler = fn;
    },
    lastRequest() {
      return captured[captured.length - 1];
    },
    requests() {
      return [...captured];
    },
  };
}

let mock: MockServer;
let storage: S3Backend;
let tmpDir: string;

beforeEach(() => {
  mock = startMockS3();
  tmpDir = join(tmpdir(), `s3-storage-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  storage = new S3Backend({
    endpoint: `http://127.0.0.1:${mock.port}`,
    bucket: BUCKET,
    accessKey: ACCESS_KEY,
    secretKey: SECRET_KEY,
    region: REGION,
    pathPrefix: "snapshots",
  });
});

afterEach(async () => {
  mock.stop();
  await storage.cleanup();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("S3Backend", () => {
  describe("putText", () => {
    test("sends PUT request to correct key path", async () => {
      const ref = await storage.putText(1, "archive.warc", "WARC/1.1\r\n");
      expect(ref).toBe("s3:snapshots/1/archive.warc");
      const req = mock.lastRequest();
      expect(req?.method).toBe("PUT");
      expect(req?.path).toBe(`/${BUCKET}/snapshots/1/archive.warc`);
    });

    test("returns s3: prefixed ref", async () => {
      const ref = await storage.putText(42, "dom.html", "<html/>");
      expect(ref).toBe("s3:snapshots/42/dom.html");
    });
  });

  describe("putBytes", () => {
    test("sends PUT with binary body", async () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const ref = await storage.putBytes(1, "screenshot.png", bytes);
      expect(ref).toBe("s3:snapshots/1/screenshot.png");
      const req = mock.lastRequest();
      expect(req?.method).toBe("PUT");
    });
  });

  describe("localPath + finalize", () => {
    test("returns a temp path and uploads on finalize", async () => {
      const p = await storage.localPath(1, "page.pdf");
      // Write something to the temp path
      await Bun.write(p, "fake-pdf-content");
      const ref = await storage.finalize(1, "page.pdf");
      expect(ref).toBe("s3:snapshots/1/page.pdf");
      const req = mock.lastRequest();
      expect(req?.method).toBe("PUT");
      expect(req?.path).toBe(`/${BUCKET}/snapshots/1/page.pdf`);
    });
  });

  describe("temp directory", () => {
    test("is private (0700), unique per backend, outside the old shared path", async () => {
      const other = new S3Backend({
        endpoint: `http://127.0.0.1:${mock.port}`,
        bucket: BUCKET,
        accessKey: ACCESS_KEY,
        secretKey: SECRET_KEY,
      });
      const a = await storage.localPath(1, "a.bin");
      const b = await other.localPath(1, "a.bin");
      expect(a).not.toBe(b);
      expect(a.startsWith(join(tmpdir(), "webfrost-s3-tmp"))).toBe(false);
      const root = dirname(dirname(a));
      expect(statSync(root).mode & 0o777).toBe(0o700);
      await storage.cleanup();
      await other.cleanup();
    });

    test("finalize uploads the file content and removes the temp file", async () => {
      const p = await storage.localPath(5, "big.bin");
      await Bun.write(p, "x".repeat(100_000));
      await storage.finalize(5, "big.bin");
      expect(existsSync(p)).toBe(false);
      expect(mock.lastRequest()?.body.length).toBe(100_000);
      await storage.cleanup();
    });

    test("cleanup and deleteAll remove leftovers", async () => {
      const p = await storage.localPath(7, "x.bin");
      await Bun.write(p, "data");
      const root = dirname(dirname(p));
      await storage.deleteAll(7);
      expect(existsSync(dirname(p))).toBe(false);
      const q = await storage.localPath(8, "y.bin");
      await Bun.write(q, "data");
      await storage.cleanup();
      expect(existsSync(root)).toBe(false);
    });

    test("finalize removes the temp file even when the upload fails", async () => {
      mock.setHandler(() => new Response("boom", { status: 500 }));
      const p = await storage.localPath(9, "z.bin");
      await Bun.write(p, "data");
      await expect(storage.finalize(9, "z.bin")).rejects.toThrow();
      expect(existsSync(p)).toBe(false);
      await storage.cleanup();
    });
  });

  describe("getBytes", () => {
    test("sends GET request and returns body", async () => {
      const bytes = await storage.getBytes("s3:snapshots/1/archive.warc");
      expect(new TextDecoder().decode(bytes)).toBe("file-content");
      const req = mock.lastRequest();
      expect(req?.method).toBe("GET");
      expect(req?.path).toBe(`/${BUCKET}/snapshots/1/archive.warc`);
    });

    test("throws on S3 error response", async () => {
      mock.setHandler(() => new Response("AccessDenied", { status: 403 }));
      await expect(storage.getBytes("s3:snapshots/1/archive.warc")).rejects.toThrow();
    });
  });

  describe("fileExists", () => {
    test("returns true when HEAD returns 200", async () => {
      expect(await storage.fileExists("s3:snapshots/1/archive.warc")).toBe(true);
      const req = mock.lastRequest();
      expect(req?.method).toBe("HEAD");
    });

    test("returns false when HEAD returns 404", async () => {
      mock.setHandler(() => new Response(null, { status: 404 }));
      expect(await storage.fileExists("s3:snapshots/1/missing.warc")).toBe(false);
    });
  });

  describe("fileSize", () => {
    test("returns content-length from HEAD response", async () => {
      const size = await storage.fileSize("s3:snapshots/1/archive.warc");
      expect(size).toBe(42);
    });

    test("returns 0 when HEAD fails", async () => {
      mock.setHandler(() => new Response(null, { status: 404 }));
      const size = await storage.fileSize("s3:snapshots/1/missing.warc");
      expect(size).toBe(0);
    });
  });

  describe("deleteAll", () => {
    test("lists objects and sends DELETE for each", async () => {
      await storage.deleteAll(1);
      const reqs = mock.requests();
      const listReq = reqs.find((r) => r.path.includes("list-type"));
      expect(listReq).toBeDefined();
      const deleteReqs = reqs.filter((r) => r.method === "DELETE");
      expect(deleteReqs.length).toBeGreaterThanOrEqual(2);
    });

    test("does not throw on list error", async () => {
      mock.setHandler(() => new Response("InternalError", { status: 500 }));
      await expect(storage.deleteAll(99)).resolves.toBeUndefined();
    });
  });

  describe("validateRef", () => {
    test("accepts refs with correct prefix", () => {
      expect(storage.validateRef("s3:snapshots/1/archive.warc")).toBe(true);
      expect(storage.validateRef("s3:snapshots/42/media/media.mp4")).toBe(true);
    });

    test("rejects refs without s3: prefix", () => {
      expect(storage.validateRef("/data/snapshots/1/archive.warc")).toBe(false);
      expect(storage.validateRef("snapshots/1/archive.warc")).toBe(false);
    });

    test("rejects refs with wrong prefix", () => {
      expect(storage.validateRef("s3:other-prefix/1/archive.warc")).toBe(false);
    });
  });

  describe("presignedDownloadUrl", () => {
    test("returns a non-empty URL string for a valid ref", () => {
      const url = storage.presignedDownloadUrl("s3:snapshots/1/page.pdf");
      expect(typeof url).toBe("string");
      expect(url.length).toBeGreaterThan(0);
      // Should contain the object key
      expect(url).toContain("snapshots/1/page.pdf");
    });

    test("uses custom expiresIn when provided", () => {
      const url = storage.presignedDownloadUrl("s3:snapshots/1/archive.warc", 600);
      // Presigned URL should contain expiry information
      expect(url).toContain("600");
    });

    test("signs response content type and disposition overrides", () => {
      const url = new URL(
        storage.presignedDownloadUrl("s3:snapshots/1/dom.html", 600, {
          contentType: "text/html",
          contentDisposition: 'attachment; filename="dom.html"',
        }),
      );
      expect(url.searchParams.get("response-content-type")).toBe("text/html");
      expect(url.searchParams.get("response-content-disposition")).toBe(
        'attachment; filename="dom.html"',
      );
    });

    test("throws on invalid ref", () => {
      expect(() => storage.presignedDownloadUrl("/local/path")).toThrow();
    });
  });

  describe("validateS3Ref helper", () => {
    test("validates key against prefix", () => {
      expect(validateS3Ref("s3:snapshots/1/archive.warc", "snapshots")).toBe(true);
      expect(validateS3Ref("s3:other/1/archive.warc", "snapshots")).toBe(false);
      expect(validateS3Ref("/local/path", "snapshots")).toBe(false);
    });
  });
});
