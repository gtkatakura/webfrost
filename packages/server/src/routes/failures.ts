import { lookup } from "node:dns/promises";
import {
  type Db,
  chunks,
  deleteSnapshotsForever,
  failureGroup,
  failureGroupSnapshotIds,
  forgetDeadHost,
  hostOf,
  listFailedSnapshots,
  listFailureDomains,
  markDeadHost,
  sql,
  summarizeFailureGroups,
  trashSnapshotIds,
} from "@webfrost/core";
import { Elysia, t } from "elysia";
import { getDb, getRunner, getStorage, longPosts } from "../context";
import { apiError, apiErrorHandler } from "../errors";
import { isoTimestampRequired, pageParams, pageQuerySchema } from "../serialize";
import { isGuestRequest } from "./auth";
import { serializeFailure } from "./snapshots";

/** At most this many domains or snapshots per bulk request. */
const MAX_HOSTS = 500;
const MAX_IDS = 5000;

const hostList = t.Array(t.String({ minLength: 1, maxLength: 253 }), { maxItems: MAX_HOSTS });
const idList = t.Array(t.Integer({ minimum: 1 }), { maxItems: MAX_IDS });

/**
 * Explicit `hosts`/`ids`, or `all` (every failed snapshot of the group, narrowed by `q` and `host` as the
 * page shows them) less `excludeHosts`/`excludeIds`: "select all N" without sending N ids.
 */
const selectionBody = t.Object({
  hosts: t.Optional(hostList),
  ids: t.Optional(idList),
  all: t.Optional(t.Boolean()),
  q: t.Optional(t.String({ maxLength: 253 })),
  host: t.Optional(t.String({ maxLength: 253 })),
  excludeHosts: t.Optional(hostList),
  excludeIds: t.Optional(idList),
});

const pageQuery = pageQuerySchema;
/** The failure lists' page size unless a request says otherwise. */
const FAILURE_PAGE = 50;

/** The lookup "Check again" asks, replaceable in tests (a real one cannot be made slow or wrong on purpose). */
export const failuresDns = { lookup: (host: string): Promise<unknown> => lookup(host) };

/** Domains looked up at once by "Check again": enough to be quick, few enough for any resolver. */
const LOOKUP_CONCURRENCY = 16;

/** Whether `host` resolves now. Only a definite "no such name" counts as gone; any other error does not. */
async function stillGone(host: string): Promise<{ gone: boolean; detail: string }> {
  try {
    await failuresDns.lookup(host);
    return { gone: false, detail: "" };
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    return { gone: code === "ENOTFOUND", detail: err instanceof Error ? err.message : String(err) };
  }
}

async function urlsOf(db: Db, ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (const chunk of chunks(ids)) {
    const rows = await db.all<{ id: number; url: string }>(
      sql`SELECT id, url FROM snapshots WHERE id IN (${sql.join(chunk)})`,
    );
    for (const r of rows) out.set(r.id, r.url);
  }
  return out;
}

/** One page of a group's failed snapshots (of one domain, of the domains containing `q`, or all). */
async function failedSnapshotsPage(
  group: string,
  host: string | undefined,
  query: { q?: string | undefined; page?: string | undefined; limit?: string | undefined },
  set: { status?: number | string },
  request: Request,
) {
  const guest = isGuestRequest(request);
  const db = await getDb();
  try {
    const result = await listFailedSnapshots(db, group, host, {
      q: query.q,
      ...pageParams(query, FAILURE_PAGE),
    });
    if (!result) return apiError(set, 404, "NOT_FOUND", "unknown failure group");
    return {
      ...result,
      items: result.items.map((s) => ({
        id: s.id,
        url: s.url,
        createdAt: isoTimestampRequired(s.createdAt),
        failure: serializeFailure(s.category, s.detail, guest),
        workingSnapshotId: s.workingSnapshotId,
      })),
    };
  } finally {
    await db.close();
  }
}

/**
 * Triage of the snapshots that could not be archived, grouped by why. Every decision here applies to
 * failed snapshots only: an earlier snapshot of the same page that worked is never touched.
 */
export const failuresRouter = new Elysia({ prefix: "/failures" })
  .onError(apiErrorHandler)
  .onBeforeHandle(longPosts)
  .get("/", async () => {
    const db = await getDb();
    try {
      return { groups: await summarizeFailureGroups(db) };
    } finally {
      await db.close();
    }
  })
  .get(
    "/:group/domains",
    async ({ params, query, set }) => {
      const db = await getDb();
      try {
        const result = await listFailureDomains(db, params.group, {
          q: query.q,
          ...pageParams(query, FAILURE_PAGE),
        });
        if (!result) return apiError(set, 404, "NOT_FOUND", "unknown failure group");
        return {
          ...result,
          items: result.items.map((d) => ({
            host: d.host,
            count: d.count,
            withWorkingSnapshot: d.withWorkingSnapshot,
            lastFailedAt: isoTimestampRequired(d.lastFailedAt),
            example: d.example,
          })),
        };
      } finally {
        await db.close();
      }
    },
    {
      params: t.Object({ group: t.String() }),
      query: t.Object({ q: t.Optional(t.String({ maxLength: 253 })), ...pageQuery }),
    },
  )
  .get(
    "/:group/snapshots",
    async ({ params, query, set, request }) =>
      failedSnapshotsPage(params.group, query.host, query, set, request),
    {
      params: t.Object({ group: t.String() }),
      query: t.Object({
        host: t.Optional(t.String({ maxLength: 253 })),
        q: t.Optional(t.String({ maxLength: 253 })),
        ...pageQuery,
      }),
    },
  )
  .get(
    "/:group/domains/:host/snapshots",
    async ({ params, query, set, request }) =>
      failedSnapshotsPage(params.group, params.host, query, set, request),
    {
      params: t.Object({ group: t.String(), host: t.String({ maxLength: 253 }) }),
      query: t.Object(pageQuery),
    },
  )
  .post(
    "/:group/retry",
    async ({ params, body, set }) => {
      if (!failureGroup(params.group))
        return apiError(set, 404, "NOT_FOUND", "unknown failure group");
      const db = await getDb();
      try {
        const ids = (await failureGroupSnapshotIds(db, params.group, body)) ?? [];
        const runner = getRunner();
        let queued = 0;
        const stillGoneHosts: string[] = [];
        let toRetry = ids;
        if (params.group === "domain-gone") {
          // Look each domain up first: one still gone keeps its snapshots as they are (a retry would only
          // fail again); one that is back is forgotten, and its snapshots are archived again.
          const urls = await urlsOf(db, ids);
          const byHost = new Map<string, number[]>();
          for (const id of ids) {
            const host = hostOf(urls.get(id) ?? "");
            if (!host) continue;
            const list = byHost.get(host);
            if (list) list.push(id);
            else byHost.set(host, [id]);
          }
          toRetry = [];
          // Lookups a few at a time (hundreds of domains in a row take minutes); the records are
          // then written one by one, in the order the domains came.
          const hosts = [...byHost.keys()];
          const checks = new Map<string, { gone: boolean; detail: string }>();
          for (let i = 0; i < hosts.length; i += LOOKUP_CONCURRENCY) {
            const batch = hosts.slice(i, i + LOOKUP_CONCURRENCY);
            const results = await Promise.all(batch.map((host) => stillGone(host)));
            batch.forEach((host, n) => checks.set(host, results[n] ?? { gone: false, detail: "" }));
          }
          for (const [host, hostIds] of byHost) {
            const check = checks.get(host) ?? { gone: false, detail: "" };
            if (check.gone) {
              await markDeadHost(db, host, check.detail);
              stillGoneHosts.push(host);
            } else {
              await forgetDeadHost(db, host);
              toRetry.push(...hostIds);
            }
          }
        }
        for (const id of toRetry) {
          if ((await runner.retry(db, id)) === "queued") queued++;
        }
        return { queued, stillGone: stillGoneHosts };
      } finally {
        await db.close();
      }
    },
    { params: t.Object({ group: t.String() }), body: selectionBody },
  )
  .post(
    "/:group/trash",
    async ({ params, body, set }) => {
      const db = await getDb();
      try {
        const ids = await failureGroupSnapshotIds(db, params.group, body);
        if (!ids) return apiError(set, 404, "NOT_FOUND", "unknown failure group");
        const moved = await trashSnapshotIds(db, ids);
        return { trashed: moved.length, ids: moved };
      } finally {
        await db.close();
      }
    },
    { params: t.Object({ group: t.String() }), body: selectionBody },
  )
  .post(
    "/:group/delete",
    async ({ params, body, set }) => {
      const db = await getDb();
      try {
        const ids = await failureGroupSnapshotIds(db, params.group, body);
        if (!ids) return apiError(set, 404, "NOT_FOUND", "unknown failure group");
        // Checked again per snapshot: one retried or trashed while this runs is not a failure to delete.
        return await deleteSnapshotsForever(db, ids, getStorage(), { onlyFailed: true });
      } finally {
        await db.close();
      }
    },
    { params: t.Object({ group: t.String() }), body: selectionBody },
  );
