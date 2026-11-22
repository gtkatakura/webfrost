import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { sql } from "kysely";
import {
  BundleError,
  type BundleManifest,
  MAX_INLINE_CONTENT_BYTES,
  exportSnapshotBundle,
  importSnapshotBundle,
  parseManifest,
  spoolToTempFile,
} from "./bundle";
import { type Db, openDb } from "./db";
import { recordResult } from "./results";
import { searchSnapshots } from "./search";
import { FilesystemBackend } from "./storage";
import { addTagToSnapshot, createTag, listSnapshotTags } from "./tags";

let root: string;
let sourceDir: string;
let targetDir: string;
let source: Db;
let target: Db;
let sourceStorage: FilesystemBackend;
let targetStorage: FilesystemBackend;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "webfrost-bundle-test-"));
  sourceDir = join(root, "source");
  targetDir = join(root, "target");
  mkdirSync(sourceDir);
  mkdirSync(targetDir);
  source = await openDb(sourceDir);
  target = await openDb(targetDir);
  sourceStorage = new FilesystemBackend(join(sourceDir, "snapshots"));
  targetStorage = new FilesystemBackend(join(targetDir, "snapshots"));
});

afterEach(async () => {
  await source.close();
  await target.close();
  rmSync(root, { recursive: true, force: true });
});

/** Pseudo-random bytes (incompressible, deterministic). */
function noise(size: number, seed = 1): Uint8Array {
  const out = new Uint8Array(size);
  let x = seed;
  for (let i = 0; i < size; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

const VIDEO = noise(700_000);
const SCREENSHOT = noise(5_000, 7);
const WARC = "WARC/1.1\r\nWARC-Type: response\r\n\r\nquokka body ".repeat(200);
const READABILITY = JSON.stringify({
  title: "Quokkas of Rottnest",
  textContent: "The quokka is a small marsupial found on Rottnest Island.",
  excerpt: "small marsupial",
});

/** A finished snapshot in the source archive, as the pipeline would leave it. */
async function seedSnapshot(): Promise<number> {
  const id = await source.insert(
    sql`INSERT INTO snapshots (url, status, created_at, color_scheme)
        VALUES ('https://example.com/quokka', 'done', '2026-03-04 05:06:07', 'dark')`,
  );
  await recordResult(source, id, {
    extractor: "html",
    content: "<p>quokka</p>",
    durationMs: 3,
    sizeBytes: 13,
  });
  await recordResult(source, id, { extractor: "readability", content: READABILITY, durationMs: 9 });
  const warcRef = await sourceStorage.putText(id, "archive.warc", WARC);
  await recordResult(source, id, { extractor: "warc", content: warcRef, sizeBytes: WARC.length });
  const shotRef = await sourceStorage.putBytes(id, "screenshot.png", SCREENSHOT);
  await recordResult(source, id, {
    extractor: "screenshot",
    content: shotRef,
    sizeBytes: SCREENSHOT.length,
  });
  const videoRef = await sourceStorage.putBytes(id, "media/media.mp4", VIDEO);
  await recordResult(source, id, {
    extractor: "media",
    content: videoRef,
    sizeBytes: VIDEO.length,
  });
  await recordResult(source, id, {
    extractor: "pdf",
    error: "browser unavailable",
    durationMs: 40,
  });
  for (const name of ["Wildlife", "Australia"]) {
    const tag = await createTag(source, name);
    await addTagToSnapshot(source, id, tag.id);
  }
  return id;
}

async function countRows(db: Db): Promise<{ snapshots: number; results: number }> {
  const s = await db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM snapshots`);
  const r = await db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM archive_results`);
  return { snapshots: Number(s?.n), results: Number(r?.n) };
}

function storedSnapshotDirs(): string[] {
  const dir = join(targetDir, "snapshots");
  return existsSync(dir) ? readdirSync(dir) : [];
}

describe("snapshot bundle round trip", () => {
  test("export from one archive, import into another: same files, results, tags; searchable; new id", async () => {
    // Occupy id 1 in the target so the import cannot reuse the source id by accident.
    await target.run(
      sql`INSERT INTO snapshots (url, status) VALUES ('https://other.example', 'done')`,
    );
    const sourceId = await seedSnapshot();
    const bundlePath = join(root, "bundle.zip");
    const { bytes } = await exportSnapshotBundle(source, sourceStorage, sourceId, bundlePath);
    expect(bytes).toBe(Bun.file(bundlePath).size);

    const imported = await importSnapshotBundle(target, targetStorage, bundlePath);
    expect(imported).toEqual({ id: 2, url: "https://example.com/quokka", status: "done" });

    const snap = await target.get<{
      url: string;
      status: string;
      created_at: string;
      color_scheme: string;
    }>(sql`SELECT url, status, created_at, color_scheme FROM snapshots WHERE id = ${imported.id}`);
    expect(snap).toEqual({
      url: "https://example.com/quokka",
      status: "done",
      created_at: "2026-03-04 05:06:07",
      color_scheme: "dark",
    });

    const rows = await target.all<{
      extractor: string;
      content: string | null;
      error: string | null;
      size_bytes: number | null;
      duration_ms: number | null;
    }>(
      sql`SELECT extractor, content, error, size_bytes, duration_ms FROM archive_results WHERE snapshot_id = ${imported.id} ORDER BY id`,
    );
    expect(rows.map((r) => [r.extractor, r.error])).toEqual([
      ["html", null],
      ["readability", null],
      ["warc", null],
      ["screenshot", null],
      ["media", null],
      ["pdf", "browser unavailable"],
    ]);
    const byExtractor = Object.fromEntries(rows.map((r) => [r.extractor, r]));
    expect(byExtractor.html?.content).toBe("<p>quokka</p>");
    expect(byExtractor.readability?.content).toBe(READABILITY);
    expect(byExtractor.readability?.duration_ms).toBe(9);

    // Files: stored by the target's backend, under the new id, byte for byte.
    const files: [string, Uint8Array, string][] = [
      ["warc", new TextEncoder().encode(WARC), "archive.warc"],
      ["screenshot", SCREENSHOT, "screenshot.png"],
      ["media", VIDEO, "media/media.mp4"],
    ];
    for (const [extractor, expected, name] of files) {
      const ref = byExtractor[extractor]?.content as string;
      expect(ref).toBe(join(targetDir, "snapshots", String(imported.id), name));
      expect(targetStorage.validateRef(ref)).toBe(true);
      expect(Buffer.from(await targetStorage.getBytes(ref)).equals(Buffer.from(expected))).toBe(
        true,
      );
      expect(Number(byExtractor[extractor]?.size_bytes)).toBe(expected.length);
    }

    expect((await listSnapshotTags(target, imported.id)).map((t) => t.name)).toEqual([
      "Australia",
      "Wildlife",
    ]);
    const hits = await searchSnapshots(target, "marsupial");
    expect(hits.items.map((h) => h.id)).toEqual([imported.id]);
    expect((await searchSnapshots(target, "wildlife")).items.map((h) => h.id)).toEqual([
      imported.id,
    ]);
  });

  test("an existing tag with the same name is reused, not duplicated", async () => {
    const sourceId = await seedSnapshot();
    const existing = await createTag(target, "Wildlife", "#00ff00");
    const bundlePath = join(root, "bundle.zip");
    await exportSnapshotBundle(source, sourceStorage, sourceId, bundlePath);
    const { id } = await importSnapshotBundle(target, targetStorage, bundlePath);
    const tags = await listSnapshotTags(target, id);
    expect(tags.find((t) => t.name === "Wildlife")?.id).toBe(existing.id);
    const all = await target.all<{ name: string }>(sql`SELECT name FROM tags ORDER BY name`);
    expect(all.map((t) => t.name)).toEqual(["Australia", "Wildlife"]);
  });

  test("importing the same bundle twice makes two snapshots", async () => {
    const sourceId = await seedSnapshot();
    const bundlePath = join(root, "bundle.zip");
    await exportSnapshotBundle(source, sourceStorage, sourceId, bundlePath);
    const a = await importSnapshotBundle(target, targetStorage, bundlePath);
    const b = await importSnapshotBundle(target, targetStorage, bundlePath);
    expect(b.id).not.toBe(a.id);
    expect((await countRows(target)).snapshots).toBe(2);
  });

  test("a snapshot that is still pending cannot be exported", async () => {
    const id = await source.insert(
      sql`INSERT INTO snapshots (url, status) VALUES ('https://x.example', 'pending')`,
    );
    await expect(
      exportSnapshotBundle(source, sourceStorage, id, join(root, "b.zip")),
    ).rejects.toThrow(/still pending/);
  });
});

// ---------------------------------------------------------------------------
// Hostile bundles
// ---------------------------------------------------------------------------

function manifest(overrides: Partial<BundleManifest> = {}, results?: unknown[]): unknown {
  return {
    format: "webfrost-snapshot",
    version: 1,
    snapshot: {
      url: "https://example.com/",
      status: "done",
      createdAt: "2026-01-02T03:04:05Z",
      colorScheme: null,
      tags: [],
    },
    results: results ?? [
      {
        extractor: "screenshot",
        file: "screenshot.png",
        error: null,
        durationMs: 1,
        sizeBytes: 4,
        createdAt: "2026-01-02T03:04:05Z",
      },
    ],
    ...overrides,
  };
}

function writeBundle(entries: Record<string, Uint8Array | string>, level: 0 | 6 = 6): string {
  const path = join(root, `bundle-${Math.random().toString(36).slice(2)}.zip`);
  const data = Object.fromEntries(
    Object.entries(entries).map(([name, v]) => [
      name,
      typeof v === "string" ? new TextEncoder().encode(v) : v,
    ]),
  );
  writeFileSync(path, zipSync(data, { level }));
  return path;
}

/** Rewrite the uncompressed size the central directory declares for `name`. */
function patchDeclaredSize(path: string, name: string, size: number): void {
  const bytes = new Uint8Array(Bun.file(path).size);
  bytes.set(require("node:fs").readFileSync(path));
  const view = new DataView(bytes.buffer);
  const needle = new TextEncoder().encode(name);
  for (let i = 0; i < bytes.length - 46; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue;
    const len = view.getUint16(i + 28, true);
    if (
      len === needle.length &&
      Buffer.from(bytes.subarray(i + 46, i + 46 + len)).equals(Buffer.from(needle))
    ) {
      view.setUint32(i + 24, size, true);
    }
  }
  writeFileSync(path, bytes);
}

async function expectRejected(path: string, message: RegExp, limits = {}): Promise<void> {
  const err = await importSnapshotBundle(target, targetStorage, path, limits).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BundleError);
  expect((err as Error).message).toMatch(message);
  expect(await countRows(target)).toEqual({ snapshots: 0, results: 0 });
  expect(storedSnapshotDirs()).toEqual([]);
}

describe("hostile bundles are rejected and store nothing", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  test("a path-traversal entry name", async () => {
    const path = writeBundle({
      "manifest.json": JSON.stringify(manifest()),
      "screenshot.png": png,
      "../../evil.sh": "rm -rf /",
    });
    await expectRejected(path, /not referenced/);
  });

  test("a manifest that references a path instead of the fixed name", async () => {
    for (const file of ["../screenshot.png", "/etc/passwd", "sub/screenshot.png", "page.pdf"]) {
      const results = [
        {
          extractor: "screenshot",
          file,
          error: null,
          durationMs: 1,
          sizeBytes: 4,
          createdAt: "2026-01-02T03:04:05Z",
        },
      ];
      const path = writeBundle({
        "manifest.json": JSON.stringify(manifest({}, results)),
        [file]: png,
      });
      await expectRejected(path, /file must be one of screenshot\.png/);
    }
  });

  test("an unknown extractor", async () => {
    const results = [
      {
        extractor: "exec",
        content: "x",
        error: null,
        durationMs: 1,
        sizeBytes: 1,
        createdAt: "2026-01-02T03:04:05Z",
      },
    ];
    const path = writeBundle({ "manifest.json": JSON.stringify(manifest({}, results)) });
    await expectRejected(path, /not a known extractor/);
  });

  test("a file the manifest does not reference", async () => {
    const path = writeBundle({
      "manifest.json": JSON.stringify(manifest()),
      "screenshot.png": png,
      "page.pdf": "%PDF-1.4",
    });
    await expectRejected(path, /"page\.pdf" is not referenced/);
  });

  test("a referenced file that is missing", async () => {
    const path = writeBundle({ "manifest.json": JSON.stringify(manifest()) });
    await expectRejected(path, /lacks/);
  });

  test("a bad manifest version", async () => {
    const path = writeBundle({
      "manifest.json": JSON.stringify(manifest({ version: 2 as 1 })),
      "screenshot.png": png,
    });
    await expectRejected(path, /unsupported bundle version 2/);
  });

  test("unknown manifest fields, bad URLs and bad timestamps", async () => {
    const cases: [unknown, RegExp][] = [
      [{ ...(manifest() as object), extra: true }, /unknown field manifest\.extra/],
      [
        manifest({
          snapshot: {
            url: "file:///etc/passwd",
            status: "done",
            createdAt: "2026-01-02T03:04:05Z",
            colorScheme: null,
            tags: [],
          },
        }),
        /http\(s\)/,
      ],
      [
        manifest({
          snapshot: {
            url: "https://x.example",
            status: "pending" as "done",
            createdAt: "2026-01-02T03:04:05Z",
            colorScheme: null,
            tags: [],
          },
        }),
        /status/,
      ],
      [
        manifest({
          snapshot: {
            url: "https://x.example",
            status: "done",
            createdAt: "yesterday",
            colorScheme: null,
            tags: [],
          },
        }),
        /createdAt/,
      ],
      [
        manifest({
          snapshot: {
            url: "https://x.example",
            status: "done",
            createdAt: "2026-01-02T03:04:05Z",
            colorScheme: null,
            tags: ["!!!"],
          },
        }),
        /tag name/,
      ],
    ];
    for (const [m, message] of cases) {
      await expectRejected(
        writeBundle({ "manifest.json": JSON.stringify(m), "screenshot.png": png }),
        message,
      );
    }
  });

  test("not a ZIP file at all", async () => {
    const path = join(root, "junk.zip");
    writeFileSync(path, "this is not a zip file, just text that is long enough");
    await expectRejected(path, /not a ZIP file/);
  });

  test("a file larger than the limit (checked from the declared sizes, before writing)", async () => {
    const path = writeBundle({
      "manifest.json": JSON.stringify(manifest()),
      "screenshot.png": new Uint8Array(200_000),
    });
    await expectRejected(path, /too large/, { maxTotalBytes: 100_000 });
  });

  test("a zip bomb that declares a small size but inflates past it", async () => {
    // 50 MB of zeros deflates to a few KB; the directory claims 4 bytes.
    const path = writeBundle({
      "manifest.json": JSON.stringify(manifest()),
      "screenshot.png": new Uint8Array(50_000_000),
    });
    patchDeclaredSize(path, "screenshot.png", 4);
    await expectRejected(path, /larger than its declared size/);
  });

  test("a stored entry whose bytes do not match its CRC", async () => {
    const path = writeBundle(
      { "manifest.json": JSON.stringify(manifest()), "screenshot.png": png },
      0,
    );
    const bytes = require("node:fs").readFileSync(path) as Buffer;
    const at = bytes.indexOf(Buffer.from(png));
    bytes[at + 1] = 0x00;
    writeFileSync(path, bytes);
    await expectRejected(path, /CRC mismatch/);
  });
});

describe("parseManifest", () => {
  test("a failed file-backed result carries no file; inline results need content", () => {
    const ok = parseManifest(
      manifest({}, [
        {
          extractor: "pdf",
          error: "timeout",
          durationMs: 5,
          sizeBytes: null,
          createdAt: "2026-01-02T03:04:05Z",
        },
        {
          extractor: "html",
          content: "<p>x</p>",
          error: null,
          durationMs: 5,
          sizeBytes: 8,
          createdAt: "2026-01-02T03:04:05Z",
        },
      ]),
    );
    expect(ok.results).toHaveLength(2);
    expect(() =>
      parseManifest(
        manifest({}, [
          {
            extractor: "html",
            content: null,
            error: null,
            durationMs: 1,
            sizeBytes: 1,
            createdAt: "2026-01-02T03:04:05Z",
          },
        ]),
      ),
    ).toThrow(/needs content/);
    expect(() =>
      parseManifest(
        manifest({}, [
          {
            extractor: "pdf",
            file: "page.pdf",
            error: "x",
            durationMs: 1,
            sizeBytes: 1,
            createdAt: "2026-01-02T03:04:05Z",
          },
        ]),
      ),
    ).toThrow(/failed result has no file/);
  });
});

describe("spoolToTempFile", () => {
  test("refuses a body past the limit and leaves no file behind", async () => {
    const body = new Blob([new Uint8Array(2048)]).stream();
    await expect(spoolToTempFile(body, root, 1024)).rejects.toThrow(/larger than 1024/);
    expect(readdirSync(join(root, "tmp"))).toEqual([]);
  });

  test("writes the body to a private file and removes it", async () => {
    const spooled = await spoolToTempFile(new Blob(["hello"]).stream(), root, 1024);
    expect(await Bun.file(spooled.path).text()).toBe("hello");
    await spooled.remove();
    expect(existsSync(spooled.path)).toBe(false);
  });
});

describe("inline results and the snapshot URL", () => {
  const at = "2026-01-02T03:04:05Z";
  const readability = (content: string) => [
    { extractor: "readability", content, error: null, durationMs: 1, sizeBytes: 1, createdAt: at },
  ];

  test("Readability fields that are not strings are refused, and nothing is stored", async () => {
    const cases: [string, RegExp][] = [
      [JSON.stringify({ title: { a: 1 } }), /title must be a string or null/],
      [JSON.stringify({ title: "ok", textContent: ["x"] }), /textContent must be a string or null/],
      [JSON.stringify({ title: "ok", excerpt: 3 }), /excerpt must be a string or null/],
      [JSON.stringify({ title: "ok", extra: { nested: true } }), /extra must not be an object/],
    ];
    for (const [content, message] of cases) {
      const path = writeBundle({
        "manifest.json": JSON.stringify(manifest({}, readability(content))),
      });
      await expectRejected(path, message);
    }
  });

  test("well-formed Readability JSON with nulls imports", async () => {
    const content = JSON.stringify({
      title: "T",
      byline: null,
      excerpt: null,
      textContent: "x",
      length: 1,
    });
    const path = writeBundle({
      "manifest.json": JSON.stringify(manifest({}, readability(content))),
    });
    const { id } = await importSnapshotBundle(target, targetStorage, path);
    expect(id).toBeGreaterThan(0);
  });

  test("inline content over the cap is refused", () => {
    const huge = "x".repeat(MAX_INLINE_CONTENT_BYTES + 1);
    const results = [
      { extractor: "html", content: huge, error: null, durationMs: 1, sizeBytes: 1, createdAt: at },
    ];
    expect(() => parseManifest(manifest({}, results))).toThrow(/larger than/);
  });

  test("the URL is stored in its parsed, normalised form", async () => {
    const snapshot = {
      url: "HTTPS://Example.COM/a b",
      status: "done" as const,
      createdAt: at,
      colorScheme: null,
      tags: [],
    };
    const html = [
      {
        extractor: "html",
        content: "<p>x</p>",
        error: null,
        durationMs: 1,
        sizeBytes: 8,
        createdAt: at,
      },
    ];
    const path = writeBundle({ "manifest.json": JSON.stringify(manifest({ snapshot }, html)) });
    const imported = await importSnapshotBundle(target, targetStorage, path);
    expect(imported.url).toBe("https://example.com/a%20b");
    const row = await target.get<{ url: string }>(
      sql`SELECT url FROM snapshots WHERE id = ${imported.id}`,
    );
    expect(row?.url).toBe("https://example.com/a%20b");
  });
});
