import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { ZipFormatError, readZipEntries, readZipEntry, readZipEntryBytes } from "./zip-reader";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "webfrost-zip-reader-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Rewrite the uncompressed size the central directory declares for every entry. */
function patchDeclaredSizes(path: string, size: number): void {
  const bytes = readFileSync(path);
  for (let i = 0; i + 46 <= bytes.length; i++) {
    if (bytes.readUInt32LE(i) === 0x02014b50) bytes.writeUInt32LE(size, i + 24);
  }
  writeFileSync(path, bytes);
}

async function bomb(name: string, inflated: number): Promise<string> {
  const path = join(root, "bomb.zip");
  writeFileSync(path, zipSync({ [name]: new Uint8Array(inflated) }, { level: 9 }));
  patchDeclaredSizes(path, 10);
  return path;
}

describe("readZipEntry against zip bombs", () => {
  test("stops within a few MB of a lying declared size, not after inflating a whole read chunk", async () => {
    // 64 MB of zeros deflates to ~64 KB: one 256 KB stream chunk would inflate all of it at once.
    const path = await bomb("screenshot.png", 64 * 1024 * 1024);
    const [entry] = await readZipEntries(path, { maxEntries: 4 });
    let error: unknown;
    try {
      for await (const _ of readZipEntry(path, entry as NonNullable<typeof entry>)) {
        // drain
      }
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ZipFormatError);
    expect((error as ZipFormatError).message).toMatch(/larger than its declared size/);
    expect((error as ZipFormatError).producedBytes).toBeLessThan(8 * 1024 * 1024);
  });

  test("the in-memory path (the manifest) is bounded the same way", async () => {
    const path = await bomb("manifest.json", 64 * 1024 * 1024);
    const [entry] = await readZipEntries(path, { maxEntries: 4 });
    const error = await readZipEntryBytes(path, entry as NonNullable<typeof entry>).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ZipFormatError);
    expect((error as ZipFormatError).producedBytes).toBeLessThan(8 * 1024 * 1024);
  });
});

describe("readZipEntries", () => {
  test("refuses a central directory larger than its entry count allows, before reading it", async () => {
    // One entry at most, but the end record claims a 300 KB central directory.
    const cdSize = 300_000;
    const file = Buffer.alloc(cdSize + 22);
    file.writeUInt32LE(0x06054b50, cdSize);
    file.writeUInt16LE(1, cdSize + 8);
    file.writeUInt16LE(1, cdSize + 10);
    file.writeUInt32LE(cdSize, cdSize + 12);
    file.writeUInt32LE(0, cdSize + 16);
    const path = join(root, "big-cd.zip");
    writeFileSync(path, file);
    await expect(readZipEntries(path, { maxEntries: 1 })).rejects.toThrow(
      /central directory too large/,
    );
  });
});
