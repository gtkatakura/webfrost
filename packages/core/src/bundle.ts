/**
 * Snapshot bundles: one finished snapshot as a single ZIP file, to move it between archives
 * (`webfrost push`, `webfrost export`, POST /api/v1/snapshots/import).
 *
 * Layout (format version 1):
 *
 *   manifest.json        the snapshot, its tags and every archive_results row
 *   screenshot.png ...   one entry per file-backed result, under a fixed name per extractor
 *
 * File names inside a bundle are not chosen by whoever made it: each file-backed extractor
 * has a fixed name (two for `media`: video or audio), so an import never takes a path, a
 * name or a content type from the bundle. The importer writes the files through the
 * StorageBackend under names it derives itself, and the server keeps serving them with
 * content types derived from the extractor, archived HTML only through the sandboxed preview.
 */
import { lstat, mkdir, readdir, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { sql } from "kysely";
import { FILE_BACKED_EXTRACTORS } from "./database/migrations";
import type { Db } from "./db";
import { extractIndexFields, indexSnapshot } from "./search";
import { IMPORTING_STATUS, removeSnapshot } from "./snapshot";
import type { StorageBackend } from "./storage";
import { MAX_TAG_NAME_LENGTH, getOrCreateTag, slugify, tagNameProblem } from "./tags";
import {
  type ZipEntry,
  ZipFormatError,
  chunksOf,
  readZipEntries,
  readZipEntry,
  readZipEntryBytes,
} from "./zip-reader";

export const BUNDLE_FORMAT = "webfrost-snapshot";
export const BUNDLE_VERSION = 1;
export const MANIFEST_NAME = "manifest.json";

/** Every extractor a bundle may carry a result for. */
export const BUNDLE_EXTRACTORS = ["html", "readability", ...FILE_BACKED_EXTRACTORS] as const;
export type BundleExtractor = (typeof BUNDLE_EXTRACTORS)[number];

type FileBackedExtractor = (typeof FILE_BACKED_EXTRACTORS)[number];

/** The names a file-backed result may have inside a bundle, and where it is stored. */
const BUNDLE_FILES: Record<FileBackedExtractor, Record<string, string>> = {
  screenshot: { "screenshot.png": "screenshot.png" },
  thumbnail: { "thumbnail.webp": "thumbnail.webp" },
  pdf: { "page.pdf": "page.pdf" },
  warc: { "archive.warc": "archive.warc" },
  "dom-snapshot": { "dom.html": "dom.html" },
  singlefile: { "singlefile.html": "singlefile.html" },
  media: { "media.mp4": "media/media.mp4", "media.mp3": "media/media.mp3" },
  "media-metadata": { "media-metadata.json": "media/media-metadata.json" },
  "media-poster": { "poster.jpg": "media/poster.jpg" },
};

/** Already-compressed formats are stored as they are; text is deflated. */
const DEFLATED = new Set(["archive.warc", "dom.html", "singlefile.html", "media-metadata.json"]);

function isFileBacked(extractor: string): extractor is FileBackedExtractor {
  return (FILE_BACKED_EXTRACTORS as readonly string[]).includes(extractor);
}

export interface BundleResult {
  extractor: BundleExtractor;
  /** Inline data (html, readability); absent for file-backed results. */
  content?: string | null;
  /** Name of the entry holding the file of a successful file-backed result. */
  file?: string;
  error: string | null;
  durationMs: number | null;
  sizeBytes: number | null;
  /** ISO 8601 UTC, e.g. "2026-11-22T10:00:00Z". */
  createdAt: string;
}

export interface BundleManifest {
  format: typeof BUNDLE_FORMAT;
  version: typeof BUNDLE_VERSION;
  snapshot: {
    url: string;
    status: "done" | "failed";
    createdAt: string;
    colorScheme: "light" | "dark" | null;
    tags: string[];
  };
  results: BundleResult[];
}

/** The bundle is malformed or breaks a rule; nothing was stored. */
export class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleError";
  }
}

/**
 * The snapshot a bundle was meant to replace (`replaces`) is not, or no longer, a failure of the same
 * URL that can be replaced: it was archived since, retried, moved to the trash, deleted, or is another
 * page. Nothing was stored.
 */
export class ReplaceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplaceConflictError";
  }
}

/** Why the failed snapshot `id` cannot be replaced by a bundle of `url`, or null when it can. */
async function replaceProblem(db: Db, id: number, url: string): Promise<string | null> {
  const row = await db.get<{ url: string; status: string; trashed_at: string | null }>(
    sql`SELECT url, status, trashed_at FROM snapshots WHERE id = ${id}`,
  );
  if (!row) return `snapshot ${id} does not exist`;
  if (row.trashed_at !== null) return `snapshot ${id} is in the trash`;
  if (row.status !== "failed") return `snapshot ${id} is ${row.status}, not failed`;
  if (row.url !== url) return `snapshot ${id} is of another URL`;
  return null;
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export interface BundleLimits {
  /** Most bytes all entries may hold once decompressed (default 2 GiB). */
  maxTotalBytes?: number;
  /** Most bytes one file may hold once decompressed (default: maxTotalBytes). */
  maxFileBytes?: number;
}

export const DEFAULT_BUNDLE_MAX_BYTES = 2 * 1024 ** 3;
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 64;
const MAX_RESULTS = 64;
const MAX_TAGS = 100;
const MAX_URL_LENGTH = 8192;
const MAX_ERROR_LENGTH = 10_000;
/**
 * Largest inline result (`html`, `readability`), in UTF-8 bytes: the pipeline's fetch never
 * returns a page over 50 MB, so a real archive never has more.
 */
export const MAX_INLINE_CONTENT_BYTES = 50 * 1024 * 1024;
/** Readability fields the app reads; each must be a string or null. */
const READABILITY_TEXT_FIELDS = ["title", "byline", "excerpt", "textContent", "content"];

/** Check the Readability JSON the list, the reader view and the search index read. */
function checkReadability(content: string, where: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    fail(`${where}.content must be the Readability JSON`);
  }
  if (!isObject(parsed)) fail(`${where}.content must be the Readability JSON`);
  for (const [key, value] of Object.entries(parsed)) {
    if (READABILITY_TEXT_FIELDS.includes(key)) {
      if (value !== null && typeof value !== "string") {
        fail(`${where}.content: Readability ${key} must be a string or null`);
      }
    } else if (value !== null && typeof value === "object") {
      fail(`${where}.content: Readability ${key} must not be an object or array`);
    }
  }
}

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

const ISO_UTC = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})Z$/;

/** "YYYY-MM-DD HH:MM:SS" (stored) -> "YYYY-MM-DDTHH:MM:SSZ". */
function toIso(stored: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(stored);
  if (m) return `${m[1]}T${m[2]}Z`;
  const d = new Date(stored);
  return Number.isNaN(d.getTime()) ? "1970-01-01T00:00:00Z" : `${d.toISOString().slice(0, 19)}Z`;
}

/** "YYYY-MM-DDTHH:MM:SSZ" -> stored form, or null when it is not a real UTC timestamp. */
function fromIso(iso: string): string | null {
  const m = ISO_UTC.exec(iso);
  if (!m) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || `${d.toISOString().slice(0, 19)}Z` !== iso) return null;
  return `${m[1]} ${m[2]}`;
}

// ---------------------------------------------------------------------------
// Manifest validation
// ---------------------------------------------------------------------------

function fail(message: string): never {
  throw new BundleError(`invalid manifest: ${message}`);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function onlyKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) fail(`unknown field ${where}.${key}`);
  }
}

function nullableInt(v: unknown, where: string): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) {
    fail(`${where} must be a non-negative integer or null`);
  }
  return v;
}

function timestamp(v: unknown, where: string): string {
  if (typeof v !== "string" || fromIso(v) === null) {
    fail(`${where} must be an ISO 8601 UTC timestamp like 2026-01-31T12:00:00Z`);
  }
  return v;
}

/** Check an untrusted manifest against format version 1, strictly: unknown fields are refused. */
export function parseManifest(raw: unknown): BundleManifest {
  if (!isObject(raw)) fail("not a JSON object");
  if (raw.format !== BUNDLE_FORMAT) fail(`format must be "${BUNDLE_FORMAT}"`);
  if (raw.version !== BUNDLE_VERSION) {
    throw new BundleError(
      `unsupported bundle version ${JSON.stringify(raw.version)} (this server reads version ${BUNDLE_VERSION})`,
    );
  }
  onlyKeys(raw, ["format", "version", "snapshot", "results"], "manifest");

  const s = raw.snapshot;
  if (!isObject(s)) fail("snapshot must be an object");
  onlyKeys(s, ["url", "status", "createdAt", "colorScheme", "tags"], "snapshot");
  if (typeof s.url !== "string" || s.url.length > MAX_URL_LENGTH)
    fail("snapshot.url must be a URL");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(s.url);
  } catch {
    fail("snapshot.url must be a URL");
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    fail("snapshot.url must be an http(s) URL");
  }
  if (s.status !== "done" && s.status !== "failed")
    fail('snapshot.status must be "done" or "failed"');
  const createdAt = timestamp(s.createdAt, "snapshot.createdAt");
  const colorScheme = s.colorScheme ?? null;
  if (colorScheme !== null && colorScheme !== "light" && colorScheme !== "dark") {
    fail('snapshot.colorScheme must be "light", "dark" or null');
  }
  const tags = s.tags ?? [];
  if (!Array.isArray(tags) || tags.length > MAX_TAGS)
    fail(`snapshot.tags must be an array of at most ${MAX_TAGS} names`);
  for (const tag of tags) {
    if (tagNameProblem(tag) !== null) fail(`invalid tag name ${JSON.stringify(tag)}`);
  }

  if (!Array.isArray(raw.results) || raw.results.length > MAX_RESULTS) {
    fail(`results must be an array of at most ${MAX_RESULTS} entries`);
  }
  const files = new Set<string>();
  const results: BundleResult[] = raw.results.map((r: unknown, i: number): BundleResult => {
    const where = `results[${i}]`;
    if (!isObject(r)) fail(`${where} must be an object`);
    onlyKeys(
      r,
      ["extractor", "content", "file", "error", "durationMs", "sizeBytes", "createdAt"],
      where,
    );
    const extractor = r.extractor;
    if (
      typeof extractor !== "string" ||
      !(BUNDLE_EXTRACTORS as readonly string[]).includes(extractor)
    ) {
      fail(`${where}.extractor ${JSON.stringify(extractor)} is not a known extractor`);
    }
    const error = r.error ?? null;
    if (error !== null && (typeof error !== "string" || error.length > MAX_ERROR_LENGTH)) {
      fail(`${where}.error must be a string of at most ${MAX_ERROR_LENGTH} characters or null`);
    }
    const base = {
      extractor: extractor as BundleExtractor,
      error: error as string | null,
      durationMs: nullableInt(r.durationMs, `${where}.durationMs`),
      sizeBytes: nullableInt(r.sizeBytes, `${where}.sizeBytes`),
      createdAt: timestamp(r.createdAt, `${where}.createdAt`),
    };

    if (isFileBacked(extractor)) {
      if (r.content !== undefined) fail(`${where}: a ${extractor} result has no inline content`);
      if (error !== null) {
        if (r.file !== undefined) fail(`${where}: a failed result has no file`);
        return base;
      }
      const allowed = BUNDLE_FILES[extractor];
      if (typeof r.file !== "string" || !Object.hasOwn(allowed, r.file)) {
        fail(`${where}.file must be one of ${Object.keys(allowed).join(", ")}`);
      }
      if (files.has(r.file)) fail(`${where}.file ${r.file} is referenced twice`);
      files.add(r.file);
      return { ...base, file: r.file };
    }

    if (r.file !== undefined) fail(`${where}: a ${extractor} result has no file`);
    const content = r.content ?? null;
    if (content !== null && typeof content !== "string")
      fail(`${where}.content must be a string or null`);
    if (error === null && content === null) fail(`${where}: a successful result needs content`);
    if (
      typeof content === "string" &&
      Buffer.byteLength(content, "utf8") > MAX_INLINE_CONTENT_BYTES
    ) {
      fail(`${where}.content is larger than ${MAX_INLINE_CONTENT_BYTES} bytes`);
    }
    if (extractor === "readability" && typeof content === "string")
      checkReadability(content, where);
    return { ...base, content: content as string | null };
  });

  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    snapshot: {
      // The parsed form, so what is stored is exactly what was validated.
      url: parsedUrl.href,
      status: s.status,
      createdAt,
      colorScheme: colorScheme as "light" | "dark" | null,
      tags: tags as string[],
    },
    results,
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

interface ResultRow {
  id: number;
  extractor: string;
  content: string | null;
  error: string | null;
  duration_ms: number | null;
  size_bytes: number | null;
  created_at: string;
}

/** The bundle name of a stored file: the fixed name for its extractor (video or audio for media). */
function bundleFileName(extractor: FileBackedExtractor, ref: string): string {
  const names = Object.keys(BUNDLE_FILES[extractor]);
  if (extractor === "media") return ref.endsWith(".mp3") ? "media.mp3" : "media.mp4";
  return names[0] as string;
}

/** What an export of a snapshot will contain. */
export interface BundlePlan {
  manifest: BundleManifest;
  /** Storage refs of the files, by bundle entry name, in manifest order. */
  files: { name: string; ref: string }[];
}

/**
 * Read a finished snapshot (done or failed) and plan its bundle. Throws BundleError when
 * the snapshot does not exist, is still being archived, or a stored file is missing.
 */
export async function planSnapshotBundle(
  db: Db,
  storage: StorageBackend,
  snapshotId: number,
): Promise<BundlePlan> {
  const snapshot = await db.get<{
    url: string;
    status: string;
    created_at: string;
    color_scheme: string | null;
  }>(sql`SELECT url, status, created_at, color_scheme FROM snapshots WHERE id = ${snapshotId}`);
  if (!snapshot) throw new BundleError(`snapshot ${snapshotId} not found`);
  if (snapshot.status !== "done" && snapshot.status !== "failed") {
    throw new BundleError(
      `snapshot ${snapshotId} is still ${snapshot.status}; wait until it finishes`,
    );
  }
  const rows = await db.all<ResultRow>(
    sql`SELECT id, extractor, content, error, duration_ms, size_bytes, created_at
        FROM archive_results WHERE snapshot_id = ${snapshotId} ORDER BY id`,
  );
  const allTags = await db.all<{ name: string }>(
    sql`SELECT t.name FROM tags t JOIN snapshot_tags st ON st.tag_id = t.id
        WHERE st.snapshot_id = ${snapshotId} ORDER BY t.name`,
  );
  // Tags created before the name rules (untrimmed, or with nothing but symbols) would make
  // the importer reject the whole bundle: write the names it accepts, trimmed when that is
  // enough, each tag once.
  const tagNames: string[] = [];
  for (const { name } of allTags) {
    const clean = name.trim();
    if (tagNameProblem(clean) === null && !tagNames.includes(clean)) tagNames.push(clean);
  }

  // A file name appears once per bundle: if an extractor somehow has two stored files, the latest wins.
  const latestFile = new Map<string, number>();
  for (const row of rows) {
    if (row.error === null && row.content && isFileBacked(row.extractor)) {
      latestFile.set(bundleFileName(row.extractor, row.content), row.id);
    }
  }

  const results: BundleResult[] = [];
  const files: { name: string; ref: string }[] = [];
  for (const row of rows) {
    if (!(BUNDLE_EXTRACTORS as readonly string[]).includes(row.extractor)) continue;
    const base = {
      extractor: row.extractor as BundleExtractor,
      error: row.error,
      durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
      sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
      createdAt: toIso(row.created_at),
    };
    if (!isFileBacked(row.extractor)) {
      results.push({ ...base, content: row.content });
      continue;
    }
    if (row.error !== null) {
      results.push(base);
      continue;
    }
    if (!row.content) continue;
    const name = bundleFileName(row.extractor, row.content);
    if (latestFile.get(name) !== row.id) continue;
    if (!storage.validateRef(row.content) || !(await storage.fileExists(row.content))) {
      throw new BundleError(
        `snapshot ${snapshotId}: the ${row.extractor} file is missing from storage`,
      );
    }
    results.push({ ...base, file: name });
    files.push({ name, ref: row.content });
  }

  return {
    manifest: {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      snapshot: {
        url: snapshot.url,
        status: snapshot.status,
        createdAt: toIso(snapshot.created_at),
        colorScheme:
          snapshot.color_scheme === "light" || snapshot.color_scheme === "dark"
            ? snapshot.color_scheme
            : null,
        tags: tagNames,
      },
      results,
    },
    files,
  };
}

/**
 * The bundle of a snapshot as a stream of ZIP bytes. Files are read from storage one at a
 * time as a stream and written out as they are read, so memory use does not grow with the
 * size of the snapshot. Entries are plain ZIP (no ZIP64), so no file may reach 4 GiB.
 */
export function snapshotBundleStream(
  storage: StorageBackend,
  plan: BundlePlan,
): ReadableStream<Uint8Array> {
  const iterator = bundleChunks(storage, plan);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}

async function* bundleChunks(
  storage: StorageBackend,
  plan: BundlePlan,
): AsyncGenerator<Uint8Array> {
  const out: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) failure = err;
    else out.push(chunk);
  });
  const drain = function* () {
    if (failure) throw failure;
    while (out.length > 0) yield out.shift() as Uint8Array;
  };

  const manifest = new ZipDeflate(MANIFEST_NAME, { level: 6 });
  zip.add(manifest);
  manifest.push(new TextEncoder().encode(JSON.stringify(plan.manifest, null, 2)), true);
  yield* drain();

  for (const { name, ref } of plan.files) {
    const entry = DEFLATED.has(name)
      ? new ZipDeflate(name, { level: 6 })
      : new ZipPassThrough(name);
    zip.add(entry);
    for await (const chunk of chunksOf(storage.getStream(ref))) {
      entry.push(chunk, false);
      yield* drain();
    }
    entry.push(new Uint8Array(0), true);
    yield* drain();
  }
  zip.end();
  yield* drain();
}

/** Write the bundle of `snapshotId` to `path`. Resolves to the number of bytes written. */
export async function exportSnapshotBundle(
  db: Db,
  storage: StorageBackend,
  snapshotId: number,
  path: string,
): Promise<{ bytes: number; manifest: BundleManifest }> {
  const plan = await planSnapshotBundle(db, storage, snapshotId);
  const writer = Bun.file(path).writer();
  let bytes = 0;
  try {
    for await (const chunk of chunksOf(snapshotBundleStream(storage, plan))) {
      writer.write(chunk);
      bytes += chunk.length;
      await writer.flush();
    }
  } finally {
    await writer.end();
  }
  return { bytes, manifest: plan.manifest };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportedSnapshot {
  id: number;
  url: string;
  status: "done" | "failed";
  /** The failed snapshot this one replaced (moved to the trash), with `replaces`. */
  replaced?: number;
}

interface CheckedBundle {
  manifest: BundleManifest;
  /** The entry of each referenced file, by bundle name. */
  entries: Map<string, ZipEntry>;
}

/** Everything that can be checked without writing anything. */
async function checkBundle(path: string, limits: BundleLimits): Promise<CheckedBundle> {
  const maxTotal = limits.maxTotalBytes ?? DEFAULT_BUNDLE_MAX_BYTES;
  const maxFile = Math.min(limits.maxFileBytes ?? maxTotal, maxTotal);

  const entries = await readZipEntries(path, { maxEntries: MAX_ENTRIES });
  const byName = new Map<string, ZipEntry>();
  for (const entry of entries) {
    if (byName.has(entry.name))
      throw new BundleError(`duplicate entry ${JSON.stringify(entry.name)}`);
    byName.set(entry.name, entry);
  }

  const manifestEntry = byName.get(MANIFEST_NAME);
  if (!manifestEntry) throw new BundleError(`the bundle has no ${MANIFEST_NAME}`);
  if (manifestEntry.size > MAX_MANIFEST_BYTES)
    throw new BundleError(`${MANIFEST_NAME} is too large`);
  let raw: unknown;
  try {
    raw = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await readZipEntryBytes(path, manifestEntry),
      ),
    );
  } catch (err) {
    if (err instanceof ZipFormatError) throw err;
    throw new BundleError(`${MANIFEST_NAME} is not valid JSON`);
  }
  const manifest = parseManifest(raw);

  const referenced = new Set(manifest.results.flatMap((r) => (r.file ? [r.file] : [])));
  for (const name of byName.keys()) {
    if (name !== MANIFEST_NAME && !referenced.has(name)) {
      throw new BundleError(`entry ${JSON.stringify(name)} is not referenced by the manifest`);
    }
  }
  const files = new Map<string, ZipEntry>();
  let total = manifestEntry.size;
  for (const name of referenced) {
    const entry = byName.get(name);
    if (!entry) throw new BundleError(`the manifest references ${name}, which the bundle lacks`);
    if (entry.size > maxFile) {
      throw new BundleError(`${name} is too large (${entry.size} bytes, at most ${maxFile})`);
    }
    total += entry.size;
    files.set(name, entry);
  }
  if (total > maxTotal) {
    throw new BundleError(
      `the bundle is too large uncompressed (${total} bytes, at most ${maxTotal})`,
    );
  }
  return { manifest, entries: files };
}

/** Copy one entry into storage under `filename`; resolves to its ref and size. */
async function storeEntry(
  storage: StorageBackend,
  snapshotId: number,
  filename: string,
  path: string,
  entry: ZipEntry,
): Promise<{ ref: string; size: number }> {
  const local = await storage.localPath(snapshotId, filename);
  const writer = Bun.file(local).writer();
  let size = 0;
  try {
    try {
      for await (const chunk of readZipEntry(path, entry)) {
        writer.write(chunk);
        size += chunk.length;
        await writer.flush();
      }
    } finally {
      await writer.end();
    }
  } catch (err) {
    // On S3 the local file is a temp file only finalize() would remove, outside the
    // snapshot's storage that deleteAll() cleans: remove it here.
    await rm(local, { force: true }).catch(() => {});
    throw err;
  }
  return { ref: await storage.finalize(snapshotId, filename), size };
}

/** The id of the tag named `name` (see getOrCreateTag), created when there is none. */
async function tagIdFor(tx: Db, name: string): Promise<number> {
  return Number((await getOrCreateTag(tx, name)).id);
}

/**
 * Import the bundle at `path` as a NEW snapshot. The bundle is checked in full first
 * (manifest, entry names, declared sizes against `limits`); a bundle that breaks a rule
 * throws BundleError and stores nothing. The files are then written through `storage`
 * while each one is decompressed and verified; if that fails, everything written so far
 * is removed again. Finally the results, tags and search index entry are written in one
 * transaction. Nothing is fetched from the network.
 *
 * While the files are copied the snapshot row exists with status `importing` (and a
 * job_queue row whose created_at says when the import started): it is hidden from lists and
 * details, cannot be retried or deleted, and the recovery sweep leaves it alone. The final
 * transaction flips it to the bundle's status only if it is still `importing`. A crash
 * leaves the row behind; sweepStaleImports() removes it later.
 *
 * `replaces` names a failed snapshot of the same URL that this bundle is the working copy of (`webfrost
 * rescue`): it must still be failed, not in the trash, and of the bundle's URL, and the bundle must be
 * done; otherwise ReplaceConflictError and nothing is stored. In the final transaction it is checked
 * again, its tags are carried over, and it is moved to the trash, so the two can never both stay, nor
 * both go.
 */
export async function importSnapshotBundle(
  db: Db,
  storage: StorageBackend,
  path: string,
  limits: BundleLimits = {},
  options: { replaces?: number | undefined } = {},
): Promise<ImportedSnapshot> {
  let checked: CheckedBundle;
  try {
    checked = await checkBundle(path, limits);
  } catch (err) {
    if (err instanceof ZipFormatError) throw new BundleError(`invalid bundle: ${err.message}`);
    throw err;
  }
  const { manifest, entries } = checked;
  const snap = manifest.snapshot;
  const replaces = options.replaces;
  if (replaces !== undefined) {
    if (snap.status !== "done") {
      throw new ReplaceConflictError("only a done snapshot can replace a failed one");
    }
    const problem = await replaceProblem(db, replaces, snap.url);
    if (problem) throw new ReplaceConflictError(problem);
  }

  const snapshotId = await db.transaction(async (tx) => {
    const id = await tx.insert(
      sql`INSERT INTO snapshots (url, status, created_at, color_scheme)
          VALUES (${snap.url}, ${IMPORTING_STATUS}, ${fromIso(snap.createdAt)}, ${snap.colorScheme})`,
    );
    // Records when the import started (the snapshot's created_at is the archive's own time).
    await tx.run(
      sql`INSERT INTO job_queue (snapshot_id, status, heartbeat_at, created_at)
          VALUES (${id}, ${IMPORTING_STATUS}, ${tx.now()}, ${tx.now()})`,
    );
    return id;
  });

  // Proves the import is alive: sweepStaleImports only removes one whose heartbeat stopped.
  const beat = setInterval(() => {
    db.run(
      sql`UPDATE job_queue SET heartbeat_at = ${db.now()} WHERE snapshot_id = ${snapshotId}`,
    ).catch(() => {});
  }, IMPORT_HEARTBEAT_MS);
  try {
    const stored = new Map<string, { ref: string; size: number }>();
    for (const result of manifest.results) {
      if (!result.file || !isFileBacked(result.extractor)) continue;
      const entry = entries.get(result.file) as ZipEntry;
      const filename = BUNDLE_FILES[result.extractor][result.file] as string;
      stored.set(result.file, await storeEntry(storage, snapshotId, filename, path, entry));
    }

    await db.transaction(async (tx) => {
      for (const r of manifest.results) {
        const file = r.file ? stored.get(r.file) : undefined;
        const content = file ? file.ref : (r.content ?? null);
        const sizeBytes = file
          ? file.size
          : content === null
            ? null
            : Buffer.byteLength(content, "utf8");
        await tx.run(
          sql`INSERT INTO archive_results (snapshot_id, extractor, content, error, duration_ms, size_bytes, created_at)
              VALUES (${snapshotId}, ${r.extractor}, ${content}, ${r.error}, ${r.durationMs},
                      ${sizeBytes}, ${fromIso(r.createdAt)})`,
        );
      }
      const tagIds = new Set<number>();
      for (const name of snap.tags) tagIds.add(await tagIdFor(tx, name));
      if (replaces !== undefined) {
        // Checked again here: the failure may have been retried or trashed while the files were copied.
        const problem = await replaceProblem(tx, replaces, snap.url);
        if (problem) throw new ReplaceConflictError(problem);
        const kept = await tx.all<{ tag_id: number }>(
          sql`SELECT tag_id FROM snapshot_tags WHERE snapshot_id = ${replaces}`,
        );
        for (const r of kept) tagIds.add(Number(r.tag_id));
        await tx.run(
          sql`UPDATE snapshots SET trashed_at = ${tx.now()} WHERE id = ${replaces} AND status = 'failed' AND trashed_at IS NULL`,
        );
      }
      for (const tagId of tagIds) {
        await tx.run(
          sql`INSERT INTO snapshot_tags (snapshot_id, tag_id) VALUES (${snapshotId}, ${tagId})`,
        );
      }
      const finished = await tx.run(
        sql`UPDATE snapshots SET status = ${snap.status} WHERE id = ${snapshotId} AND status = ${IMPORTING_STATUS}`,
      );
      if (finished === 0) throw new Error(`snapshot ${snapshotId} changed while it was imported`);
      await tx.run(sql`DELETE FROM job_queue WHERE snapshot_id = ${snapshotId}`);
      // Like the pipeline: only finished, successful snapshots are searchable.
      if (snap.status === "done") {
        const readability = manifest.results.find(
          (r) => r.extractor === "readability" && r.error === null,
        );
        const { title, textContent, tags } = await extractIndexFields(
          tx,
          snapshotId,
          readability?.content,
        );
        await indexSnapshot(tx, snapshotId, snap.url, title, textContent, tags);
      }
    });
  } catch (err) {
    await removeSnapshot(db, snapshotId, storage, true).catch(() => {});
    // The id belongs to this import alone. When a sweep already removed the row,
    // removeSnapshot left the files this import wrote since then.
    await storage.deleteAll(snapshotId).catch(() => {});
    if (err instanceof ZipFormatError) throw new BundleError(`invalid bundle: ${err.message}`);
    throw err;
  } finally {
    clearInterval(beat);
  }

  return {
    id: snapshotId,
    url: snap.url,
    status: snap.status,
    ...(replaces !== undefined ? { replaced: replaces } : {}),
  };
}

/** How often a running import refreshes its job_queue heartbeat. */
const IMPORT_HEARTBEAT_MS = 30_000;

/** An import whose heartbeat is this old was interrupted (a crash or a restart). */
export const STALE_IMPORT_SECONDS = 5 * 60;

/** A spool folder untouched for this long belongs to an upload that died. */
export const STALE_UPLOAD_SECONDS = 60 * 60;

/** How often a spool folder in use has its modification time refreshed. */
let spoolKeepAliveMs = 60_000;
/** Test hook: shorten the keep-alive interval. */
export function setSpoolKeepAliveMs(ms: number): void {
  spoolKeepAliveMs = ms;
}

/**
 * Remove snapshots left `importing` by an import that never finished (the process died while
 * copying files), together with their files: they have no results, so there is nothing to
 * keep. Only imports whose heartbeat (the start time when it never beat) is more than
 * `olderThanSeconds` old are touched, so one that another process is running is left alone. Resolves to the number removed.
 */
export async function sweepStaleImports(
  db: Db,
  storage: StorageBackend,
  olderThanSeconds = STALE_IMPORT_SECONDS,
): Promise<number> {
  const stale = await db.all<{ id: number }>(
    sql`SELECT s.id FROM snapshots s
        WHERE s.status = ${IMPORTING_STATUS}
          AND NOT EXISTS (
            SELECT 1 FROM job_queue j
            WHERE j.snapshot_id = s.id AND COALESCE(j.heartbeat_at, j.created_at) >= ${db.ago(olderThanSeconds)}
          )`,
  );
  let removed = 0;
  for (const { id } of stale) {
    if (await removeSnapshot(db, Number(id), storage, true)) removed++;
  }
  return removed;
}

/** Name of a spool folder made by spoolToTempFile, under WEBFROST_DIR/tmp. */
const SPOOL_FOLDER = /^bundle-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Remove upload spool folders (`WEBFROST_DIR/tmp/bundle-<uuid>`) older than `olderThanMs`,
 * left by a process that died mid-upload. Nothing else in tmp/ is touched. Resolves to the
 * number removed.
 */
export async function sweepStaleBundleUploads(
  dir: string,
  olderThanMs = STALE_UPLOAD_SECONDS * 1000,
): Promise<number> {
  const tmpRoot = join(dir, "tmp");
  let names: string[];
  try {
    names = await readdir(tmpRoot);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!SPOOL_FOLDER.test(name)) continue;
    const folder = join(tmpRoot, name);
    try {
      const info = await lstat(folder);
      if (!info.isDirectory() || Date.now() - info.mtimeMs < olderThanMs) continue;
      await rm(folder, { recursive: true, force: true });
      removed++;
    } catch {
      // Gone already, or not ours to remove.
    }
  }
  return removed;
}

/**
 * Write `body` to a private temporary file under `dir`, refusing more than `maxBytes`.
 * Resolves to the file's path and a function that removes it. Throws BundleTooLargeError
 * past the limit (the partial file is removed).
 */
export async function spoolToTempFile(
  body: ReadableStream<Uint8Array>,
  dir: string,
  maxBytes: number,
): Promise<{ path: string; bytes: number; remove: () => Promise<void> }> {
  const tmpRoot = join(dir, "tmp");
  await mkdir(tmpRoot, { recursive: true, mode: 0o700 });
  const folder = join(tmpRoot, `bundle-${crypto.randomUUID()}`);
  await mkdir(folder, { mode: 0o700 });
  const path = join(folder, "bundle.zip");
  // The folder's mtime is what sweepStaleBundleUploads reads; keep it fresh until the
  // caller is done with the file, so a slow upload or a long import is never swept.
  const keepAlive = setInterval(() => {
    const now = new Date();
    void utimes(folder, now, now).catch(() => {});
  }, spoolKeepAliveMs);
  keepAlive.unref();
  const remove = async () => {
    clearInterval(keepAlive);
    await rm(folder, { recursive: true, force: true });
  };
  const writer = Bun.file(path).writer();
  let bytes = 0;
  try {
    for await (const chunk of chunksOf(body)) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw new BundleTooLargeError(maxBytes);
      writer.write(chunk);
      await writer.flush();
    }
    await writer.end();
  } catch (err) {
    await Promise.resolve(writer.end()).catch(() => {});
    await remove();
    throw err;
  }
  return { path, bytes, remove };
}

export class BundleTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`bundle larger than ${maxBytes} bytes`);
    this.name = "BundleTooLargeError";
  }
}
