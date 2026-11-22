import {
  BundleError,
  BundleTooLargeError,
  importSnapshotBundle,
  spoolToTempFile,
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
 */
export const snapshotImportRouter = new Elysia({ prefix: "/snapshots" })
  .onError(apiErrorHandler)
  .post(
    "/import",
    async ({ request, set, server }) => {
      if (!request.body)
        return apiError(set, 400, "VALIDATION", "the body must be a snapshot bundle");
      // A large upload and its import can outlast the listener's idle timeout.
      try {
        server?.timeout(request, 0);
      } catch {
        // Not served by Bun.serve (in-process tests).
      }

      const maxBytes = importBundleMaxBytes();
      let spooled: Awaited<ReturnType<typeof spoolToTempFile>>;
      try {
        spooled = await spoolToTempFile(request.body, getWebfrostDir(), maxBytes);
      } catch (err) {
        if (err instanceof BundleTooLargeError) {
          return apiError(set, 413, "PAYLOAD_TOO_LARGE", "bundle too large");
        }
        throw err;
      }

      const db = await getDb();
      try {
        const imported = await importSnapshotBundle(db, getStorage(), spooled.path, {
          maxTotalBytes: maxBytes,
        });
        logger.info({ snapshotId: imported.id, bytes: spooled.bytes }, "snapshot bundle imported");
        set.status = 201;
        return imported;
      } catch (err) {
        if (err instanceof BundleError) return apiError(set, 400, "VALIDATION", err.message);
        throw err;
      } finally {
        await db.close();
        await spooled.remove();
      }
    },
    // The body is read as a stream above; Elysia must not parse (or buffer) it.
    { parse: "none" },
  );
