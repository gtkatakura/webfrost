/**
 * S3Backend integration tests — run against a real MinIO instance.
 *
 * These tests are skipped by default and only run when MINIO_TEST_ENDPOINT
 * is set (e.g. in CI with the MinIO service, or locally via docker-compose.dev.yml).
 *
 * Required env vars:
 *   MINIO_TEST_ENDPOINT   — e.g. http://localhost:9000
 *   MINIO_TEST_BUCKET     — bucket that already exists (default: webfrost-test)
 *   MINIO_TEST_ACCESS_KEY — access key (default: minioadmin)
 *   MINIO_TEST_SECRET_KEY — secret key (default: minioadmin)
 *
 * Local dev usage:
 *   docker compose -f docker-compose.dev.yml up -d
 *   MINIO_TEST_ENDPOINT=http://localhost:9000 bun test src/storage/s3.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { S3Backend } from "./s3";

const endpoint = process.env.MINIO_TEST_ENDPOINT;
const bucket = process.env.MINIO_TEST_BUCKET ?? "webfrost-integration";
const accessKey = process.env.MINIO_TEST_ACCESS_KEY ?? "minioadmin";
const secretKey = process.env.MINIO_TEST_SECRET_KEY ?? "minioadmin";

const RUN = !!endpoint;

/** Conditionally skip the entire suite when MinIO is not available. */
const describeIntegration = RUN ? describe : describe.skip;

let storage: S3Backend;
const testPrefix = `integration-${Date.now()}`;
const snapshotId = 9999;

beforeAll(() => {
  if (!RUN) return;
  storage = new S3Backend({
    endpoint: endpoint as string,
    bucket,
    accessKey,
    secretKey,
    region: "us-east-1",
    pathPrefix: testPrefix,
  });
});

afterAll(async () => {
  if (!RUN) return;
  // Clean up all test objects written during this run
  await storage.deleteAll(snapshotId);
  await storage.cleanup();
});

describeIntegration("S3Backend — integration (real MinIO)", () => {
  test("putText writes a file and getBytes reads it back", async () => {
    const content = "WARC/1.1\r\nWARC-Type: warcinfo\r\n\r\n";
    const ref = await storage.putText(snapshotId, "archive.warc", content);
    expect(ref).toBe(`s3:${testPrefix}/${snapshotId}/archive.warc`);

    const bytes = await storage.getBytes(ref);
    expect(new TextDecoder().decode(bytes)).toBe(content);
  });

  test("putBytes writes binary and getBytes reads it back", async () => {
    const original = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG header
    const ref = await storage.putBytes(snapshotId, "screenshot.png", original);
    expect(ref).toBe(`s3:${testPrefix}/${snapshotId}/screenshot.png`);

    const back = await storage.getBytes(ref);
    expect(back).toEqual(original);
  });

  test("localPath + finalize uploads via temp file", async () => {
    const p = await storage.localPath(snapshotId, "page.pdf");
    expect(typeof p).toBe("string");

    await Bun.write(p, "fake-pdf-bytes");
    const ref = await storage.finalize(snapshotId, "page.pdf");
    expect(ref).toBe(`s3:${testPrefix}/${snapshotId}/page.pdf`);

    const bytes = await storage.getBytes(ref);
    expect(new TextDecoder().decode(bytes)).toBe("fake-pdf-bytes");
  });

  test("fileExists returns true for uploaded file, false for missing key", async () => {
    const ref = await storage.putText(snapshotId, "dom.html", "<html/>");
    expect(await storage.fileExists(ref)).toBe(true);
    expect(await storage.fileExists(`s3:${testPrefix}/${snapshotId}/nonexistent.xyz`)).toBe(false);
  });

  test("fileSize returns correct byte count", async () => {
    const content = "hello world!";
    const ref = await storage.putText(snapshotId, "size-test.txt", content);
    const size = await storage.fileSize(ref);
    expect(size).toBe(Buffer.byteLength(content, "utf8"));
  });

  test("validateRef accepts valid refs and rejects foreign refs", () => {
    const validRef = `s3:${testPrefix}/${snapshotId}/archive.warc`;
    expect(storage.validateRef(validRef)).toBe(true);
    expect(storage.validateRef("/local/path/to/file")).toBe(false);
    expect(storage.validateRef("s3:other-prefix/1/file.txt")).toBe(false);
  });

  test("presignedDownloadUrl returns a URL containing the key", () => {
    const ref = `s3:${testPrefix}/${snapshotId}/archive.warc`;
    const url = storage.presignedDownloadUrl(ref);
    expect(typeof url).toBe("string");
    expect(url).toContain(`${testPrefix}/${snapshotId}/archive.warc`);
  });

  test("deleteAll removes all objects for the snapshot", async () => {
    // Write a couple of files
    const r1 = await storage.putText(snapshotId, "cleanup-a.txt", "a");
    const r2 = await storage.putText(snapshotId, "cleanup-b.txt", "b");

    await storage.deleteAll(snapshotId);

    expect(await storage.fileExists(r1)).toBe(false);
    expect(await storage.fileExists(r2)).toBe(false);
  });
});
