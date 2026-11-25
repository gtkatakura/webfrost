import {
  BundleError,
  BundleTooLargeError,
  ReplaceConflictError,
  importSnapshotBundle,
  spoolToTempFile,
  sql,
} from "@webfrost/core";
import { Elysia } from "elysia";
import { getDb, getStorage, getWebfrostDir } from "../context";
import { apiError, apiErrorHandler } from "../errors";
import { importBundleMaxBytes } from "../limits";
import { logger } from "../logger";

/**
 * POST /snapshots/import: store a snapshot that was archived elsewhere (`webfrost push`).
 *
 * The body is a snapshot bundle (application/zip), streamed to a private file under
 * WEBFROST_DIR/tmp and counted on the way, then checked and imported by core: a new
 * snapshot with a new id. Nothing is fetched. The request guard has already refused other
 * content types and a declared length over WEBFROST_IMPORT_BUNDLE_MAX_BYTES; the auth plugin
 * requires an API key or a session (with the CSRF check) like every other write.
 *
 * `?replaces=<id>` (`webfrost rescue`): the bundle is the working copy of that failed snapshot. It must
 * be a done snapshot of the same URL, and the failure still failed and not in the trash; then the
 * failure moves to the trash in the same transaction. Otherwise 409 and nothing is stored.
 *
 * At most MAX_CONCURRENT_BUNDLE_IMPORTS run at once (each can hold a 2 GiB upload on disk
 * and keep storage busy); beyond that the request is refused with 429 before its body is read.
 */

/** Bundle imports this process runs at the same time. */
export const MAX_CONCURRENT_BUNDLE_IMPORTS = 2;
/** Seconds a client is asked to wait when every import slot is taken. */
const BUSY_RETRY_AFTER_SECONDS = 30;
/**
 * Idle timeout of an import upload, in seconds: the connection may go this long without
 * data (a slow uplink) before it is closed, so a stalled client cannot hold an import slot
 * forever. 255 s is the most Bun accepts: larger values wrap around (600 behaves like 88).
 * Once the upload is complete the server is the one working (copying into storage, which
 * for a large bundle on S3 can take longer), so the timeout is lifted until it answers.
 */
export const BUNDLE_IMPORT_IDLE_TIMEOUT_SECONDS = 255;

let activeImports = 0;

/** Bundle imports running now (for tests and diagnostics). */
export function activeBundleImports(): number {
  return activeImports;
}
export const snapshotImportRouter = new Elysia({ prefix: "/snapshots" })
  .onError(apiErrorHandler)
  .post(
    "/import",
    async ({ request, set, server }) => {
      if (!request.body)
        return apiError(set, 400, "VALIDATION", "the body must be a snapshot bundle");
      const raw = new URL(request.url).searchParams.get("replaces");
      if (raw !== null && !/^[1-9][0-9]{0,14}$/.test(raw))
        return apiError(set, 400, "VALIDATION", "replaces must be a snapshot id");
      const replaces = raw === null ? undefined : Number(raw);
      if (replaces !== undefined) {
        // Before the upload is read: a failure that is already gone needs no gigabytes sent.
        const problem = await replaceablePreCheck(replaces);
        if (problem) return apiError(set, 409, "CONFLICT", problem);
      }
      if (activeImports >= MAX_CONCURRENT_BUNDLE_IMPORTS) {
        set.headers["retry-after"] = String(BUSY_RETRY_AFTER_SECONDS);
        return apiError(set, 429, "RATE_LIMITED", "too many bundle imports at once; retry later");
      }
      activeImports++;
      try {
        return await importBody(request, request.body, set, server, replaces);
      } finally {
        activeImports--;
      }
    },
    // The body is read as a stream above; Elysia must not parse (or buffer) it.
    { parse: "none" },
  );

async function importBody(
  request: Request,
  body: ReadableStream<Uint8Array>,
  set: { status?: number | string; headers: Record<string, unknown> },
  server: { timeout(request: Request, seconds: number): void } | null,
  replaces: number | undefined,
) {
  const setIdleTimeout = (seconds: number) => {
    try {
      server?.timeout(request, seconds);
    } catch {
      // Not served by Bun.serve (in-process tests).
    }
  };
  // A slow upload can outlast the listener's default idle timeout; a stalled one may not
  // hold the slot past this.
  setIdleTimeout(BUNDLE_IMPORT_IDLE_TIMEOUT_SECONDS);

  const maxBytes = importBundleMaxBytes();
  let spooled: Awaited<ReturnType<typeof spoolToTempFile>>;
  try {
    spooled = await spoolToTempFile(body, getWebfrostDir(), maxBytes);
  } catch (err) {
    if (err instanceof BundleTooLargeError) {
      return apiError(set, 413, "PAYLOAD_TOO_LARGE", "bundle too large");
    }
    throw err;
  }
  // The whole body is in; what remains is bounded server-side work.
  setIdleTimeout(0);

  // The spool is removed whatever happens next, the database included (it may fail to open).
  try {
    const db = await getDb();
    try {
      const imported = await importSnapshotBundle(
        db,
        getStorage(),
        spooled.path,
        { maxTotalBytes: maxBytes },
        { replaces },
      );
      logger.info(
        { snapshotId: imported.id, bytes: spooled.bytes, replaced: imported.replaced },
        "snapshot bundle imported",
      );
      set.status = 201;
      return imported;
    } catch (err) {
      if (err instanceof ReplaceConflictError) return apiError(set, 409, "CONFLICT", err.message);
      if (err instanceof BundleError) return apiError(set, 400, "VALIDATION", err.message);
      throw err;
    } finally {
      await db.close().catch(() => {});
    }
  } finally {
    await spooled.remove();
  }
}

/** The part of the `replaces` check that needs no bundle (the URL is checked once it is read). */
async function replaceablePreCheck(id: number): Promise<string | null> {
  const db = await getDb();
  try {
    const row = await db.get<{ status: string; trashed_at: string | null }>(
      sql`SELECT status, trashed_at FROM snapshots WHERE id = ${id}`,
    );
    if (!row) return `snapshot ${id} does not exist`;
    if (row.trashed_at !== null) return `snapshot ${id} is in the trash`;
    if (row.status !== "failed") return `snapshot ${id} is ${row.status}, not failed`;
    return null;
  } finally {
    await db.close();
  }
}
