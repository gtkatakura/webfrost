import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemBackend } from "./filesystem";

let testDir: string;
let storage: FilesystemBackend;

beforeEach(() => {
  testDir = join(tmpdir(), `fs-storage-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  storage = new FilesystemBackend(testDir);
});

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("FilesystemBackend", () => {
  describe("localPath + finalize", () => {
    test("creates parent directory and returns the final absolute path", async () => {
      const p = await storage.localPath(1, "screenshot.png");
      expect(p).toBe(join(testDir, "1", "screenshot.png"));
      expect(existsSync(join(testDir, "1"))).toBe(true);
    });

    test("finalize returns the same path without reading or moving the file", async () => {
      await storage.localPath(1, "page.pdf");
      // Write a fake file
      writeFileSync(join(testDir, "1", "page.pdf"), "fake-pdf");
      const ref = await storage.finalize(1, "page.pdf");
      expect(ref).toBe(join(testDir, "1", "page.pdf"));
    });
  });

  describe("putText", () => {
    test("writes text content and returns the absolute path as ref", async () => {
      const ref = await storage.putText(1, "archive.warc", "WARC/1.1\r\n");
      expect(ref).toBe(join(testDir, "1", "archive.warc"));
      expect(existsSync(ref)).toBe(true);
      const content = await Bun.file(ref).text();
      expect(content).toBe("WARC/1.1\r\n");
    });

    test("creates parent directories if needed", async () => {
      const ref = await storage.putText(42, "media/media-metadata.json", "{}");
      expect(ref).toBe(join(testDir, "42", "media", "media-metadata.json"));
      expect(existsSync(ref)).toBe(true);
    });
  });

  describe("putBytes", () => {
    test("writes binary content and returns the ref", async () => {
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      const ref = await storage.putBytes(1, "screenshot.png", bytes);
      expect(ref).toBe(join(testDir, "1", "screenshot.png"));
      const written = await Bun.file(ref).bytes();
      expect(Array.from(written)).toEqual([0x89, 0x50, 0x4e, 0x47]);
    });
  });

  describe("getBytes", () => {
    test("reads file bytes by ref", async () => {
      const ref = await storage.putText(1, "dom.html", "<html/>");
      const bytes = await storage.getBytes(ref);
      expect(new TextDecoder().decode(bytes)).toBe("<html/>");
    });
  });

  describe("fileExists", () => {
    test("returns true for an existing file", async () => {
      const ref = await storage.putText(1, "test.txt", "hello");
      expect(await storage.fileExists(ref)).toBe(true);
    });

    test("returns false for a non-existent file", async () => {
      expect(await storage.fileExists(join(testDir, "1", "missing.txt"))).toBe(false);
    });
  });

  describe("fileSize", () => {
    test("returns byte size of the file", async () => {
      const ref = await storage.putText(1, "test.txt", "hello");
      const size = await storage.fileSize(ref);
      expect(size).toBe(5);
    });

    test("returns 0 for a non-existent file", async () => {
      const size = await storage.fileSize(join(testDir, "1", "ghost.txt"));
      expect(size).toBe(0);
    });
  });

  describe("deleteAll", () => {
    test("deletes all files for a snapshot ID", async () => {
      await storage.putText(1, "archive.warc", "WARC");
      await storage.putText(1, "dom.html", "<html/>");
      expect(existsSync(join(testDir, "1"))).toBe(true);

      await storage.deleteAll(1);
      expect(existsSync(join(testDir, "1"))).toBe(false);
    });

    test("does not throw if snapshot directory does not exist", async () => {
      await expect(storage.deleteAll(9999)).resolves.toBeUndefined();
    });
  });

  describe("validateRef", () => {
    test("accepts refs within the storage dir", async () => {
      const ref = await storage.putText(1, "archive.warc", "WARC");
      expect(storage.validateRef(ref)).toBe(true);
    });

    test("rejects refs outside the storage dir", () => {
      expect(storage.validateRef("/etc/passwd")).toBe(false);
      expect(storage.validateRef("/tmp/other/file.txt")).toBe(false);
    });

    test("rejects S3 refs", () => {
      expect(storage.validateRef("s3:snapshots/1/archive.warc")).toBe(false);
    });
  });
});
