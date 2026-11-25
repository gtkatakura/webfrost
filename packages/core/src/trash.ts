import { sql } from "kysely";
import { getTrashRetentionDays } from "./app-settings";
import { chunks } from "./chunks";
import type { Db } from "./db";
import { pageWindow } from "./list";
import { type DeleteOnly, IMPORTING_STATUS, SnapshotBusyError, deleteSnapshot } from "./snapshot";
import type { StorageBackend } from "./storage";

/**
 * The trash: a snapshot moved here is hidden from every list, search and count, keeps its files, and is
 * deleted for good once it has been here longer than the retention (Settings, 30 days by default).
 * Until then it can be restored as it was. Deleting from the trash, or emptying it, is immediate.
 */

export interface TrashedSnapshot {
  id: number;
  url: string;
  status: string;
  failure_category: string | null;
  failure_detail: string | null;
  created_at: string;
  trashed_at: string;
}

/** Move snapshots to the trash. Snapshots being archived or imported are left alone. Returns how many moved. */
export async function trashSnapshots(db: Db, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  let moved = 0;
  for (const chunk of chunks(ids)) {
    moved += await db.run(
      sql`UPDATE snapshots SET trashed_at = ${db.now()}
          WHERE id IN (${sql.join(chunk)}) AND trashed_at IS NULL
            AND status NOT IN ('pending', ${IMPORTING_STATUS})`,
    );
  }
  return moved;
}

/** Bring snapshots back from the trash. Returns how many came back. */
export async function restoreSnapshots(db: Db, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  let restored = 0;
  for (const chunk of chunks(ids)) {
    restored += await db.run(
      sql`UPDATE snapshots SET trashed_at = NULL WHERE id IN (${sql.join(chunk)}) AND trashed_at IS NOT NULL`,
    );
  }
  return restored;
}

/**
 * Delete snapshots for good, files included. `onlyTrashed` limits it to snapshots in the trash (the trash
 * page and the retention purge) and `onlyFailed` to failed snapshots outside it (the failure pages). Each
 * snapshot is checked again when its turn comes, so one restored or archived again while a long delete
 * runs is left alone. Snapshots being archived are skipped.
 */
export async function deleteSnapshotsForever(
  db: Db,
  ids: number[],
  storage: StorageBackend,
  options: { onlyTrashed?: boolean; onlyFailed?: boolean; trashedForSeconds?: number } = {},
): Promise<{ deleted: number; busy: number }> {
  const only: DeleteOnly | undefined =
    options.trashedForSeconds !== undefined
      ? { trashedForSeconds: options.trashedForSeconds }
      : options.onlyTrashed
        ? "trashed"
        : options.onlyFailed
          ? "failed"
          : undefined;
  let deleted = 0;
  let busy = 0;
  // No filtering up front: each snapshot is checked under its lock when its turn comes.
  for (const id of ids) {
    try {
      if (await deleteSnapshot(db, id, storage, only)) deleted++;
    } catch (err) {
      if (!(err instanceof SnapshotBusyError)) throw err;
      busy++;
    }
  }
  return { deleted, busy };
}

/** One page of the trash, most recently trashed first. */
export async function listTrash(
  db: Db,
  requestedPage: number,
  requestedLimit: number,
): Promise<{ items: TrashedSnapshot[]; total: number; page: number; limit: number }> {
  const { page, limit, offset } = pageWindow(requestedPage, requestedLimit);
  const total = Number(
    (
      await db.get<{ n: number }>(
        sql`SELECT COUNT(*) AS n FROM snapshots WHERE trashed_at IS NOT NULL`,
      )
    )?.n ?? 0,
  );
  const items = await db.all<TrashedSnapshot>(
    sql`SELECT id, url, status, failure_category, failure_detail, created_at, trashed_at
        FROM snapshots WHERE trashed_at IS NOT NULL
        ORDER BY trashed_at DESC, id DESC
        LIMIT ${limit} OFFSET ${offset}`,
  );
  return { items, total, page, limit };
}

/** Every id in the trash (for "empty trash"). */
export async function trashedIds(db: Db, exclude: number[] = []): Promise<number[]> {
  const skip = new Set(exclude);
  return (await db.all<{ id: number }>(sql`SELECT id FROM snapshots WHERE trashed_at IS NOT NULL`))
    .map((r) => r.id)
    .filter((id) => !skip.has(id));
}

/** Delete for good what has been in the trash longer than the retention. Returns how many went. */
export async function purgeExpiredTrash(db: Db, storage: StorageBackend): Promise<number> {
  const days = await getTrashRetentionDays(db);
  const expired = await db.all<{ id: number }>(
    sql`SELECT id FROM snapshots WHERE trashed_at IS NOT NULL AND trashed_at < ${db.ago(days * 24 * 60 * 60)}`,
  );
  const { deleted } = await deleteSnapshotsForever(
    db,
    expired.map((r) => r.id),
    storage,
    // Checked again per snapshot: one restored and trashed again meanwhile is not expired.
    { trashedForSeconds: days * 24 * 60 * 60 },
  );
  return deleted;
}
