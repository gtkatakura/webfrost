import { sql } from "kysely";
import type { Db } from "./db";
import { hostOf } from "./dead-hosts";
import type { FailureCategory } from "./failure";
import { pageWindow } from "./list";

/**
 * The failed snapshots, sorted into groups a person can decide about at once: each group is a set of
 * failure categories that call for the same decision. Snapshots in the trash are never in a group, and
 * only failed snapshots are: a page that failed today may well have an earlier snapshot that worked,
 * and that one is never touched from here.
 */
export const FAILURE_GROUPS = [
  { id: "domain-gone", label: "Domain no longer exists", categories: ["domain_not_found"] },
  { id: "page-gone", label: "Page gone", categories: ["page_not_found"] },
  { id: "blocked", label: "Blocked by the site", categories: ["access_denied", "refused_client"] },
  { id: "rate-limited", label: "Rate limited", categories: ["rate_limited"] },
  {
    id: "temporary",
    label: "Temporary problems",
    categories: ["timeout", "server_error", "network_error", "dns_error"],
  },
  {
    id: "site-setup",
    label: "Site misconfigured",
    categories: ["tls_error", "redirect_loop", "bad_request", "unsupported_url"],
  },
  { id: "private-address", label: "Private address", categories: ["private_address"] },
  { id: "interrupted", label: "Interrupted", categories: ["interrupted", "no_output", "error"] },
  // Snapshots that failed before WebFrost stored why.
  { id: "unknown", label: "Reason not recorded", categories: [] },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  categories: readonly FailureCategory[];
}>;

export type FailureGroupId = (typeof FAILURE_GROUPS)[number]["id"];

export function failureGroup(id: string) {
  return FAILURE_GROUPS.find((g) => g.id === id);
}

/** The group a category belongs to ("unknown" for none). */
export function groupOfCategory(category: string | null): FailureGroupId {
  if (!category) return "unknown";
  for (const g of FAILURE_GROUPS) {
    if ((g.categories as readonly string[]).includes(category)) return g.id;
  }
  return "interrupted";
}

function groupWhere(group: (typeof FAILURE_GROUPS)[number]) {
  const base = sql`s.status = 'failed' AND s.trashed_at IS NULL`;
  if (group.id === "unknown") return sql`${base} AND s.failure_category IS NULL`;
  if (group.id === "interrupted") {
    // Also any category this version does not know, so nothing falls through the cracks.
    const known = FAILURE_GROUPS.flatMap((g) => g.categories as readonly string[]).filter(
      (c) => !(group.categories as readonly string[]).includes(c),
    );
    return sql`${base} AND s.failure_category IS NOT NULL AND s.failure_category NOT IN (${sql.join(known)})`;
  }
  return sql`${base} AND s.failure_category IN (${sql.join([...group.categories])})`;
}

interface FailedRow {
  id: number;
  url: string;
  created_at: string;
  failure_category: string | null;
  failure_detail: string | null;
  /** An earlier (or later) snapshot of the same URL that worked and is not in the trash. */
  ok_id: number | null;
}

async function failedRows(db: Db, group: (typeof FAILURE_GROUPS)[number]): Promise<FailedRow[]> {
  // One pass over the working snapshots, joined by URL. A correlated subquery per failed row let SQLite
  // pick the status index and scan every done snapshot once per failure (a second per request on an
  // archive of a few thousand).
  return db.all<FailedRow>(
    sql`SELECT s.id, s.url, s.created_at, s.failure_category, s.failure_detail, ok.ok_id
        FROM snapshots s
        LEFT JOIN (SELECT url, MAX(id) AS ok_id FROM snapshots
                    WHERE status = 'done' AND trashed_at IS NULL GROUP BY url) ok ON ok.url = s.url
        WHERE ${groupWhere(group)}
        ORDER BY s.id DESC`,
  );
}

export interface FailureGroupSummary {
  id: FailureGroupId;
  label: string;
  categories: readonly string[];
  /** Failed snapshots in the group. */
  count: number;
  /** Distinct domains among them. */
  domains: number;
}

/** Every group with its counts, in the order of FAILURE_GROUPS (empty groups included). */
export async function summarizeFailureGroups(db: Db): Promise<FailureGroupSummary[]> {
  const rows = await db.all<{ url: string; failure_category: string | null }>(
    sql`SELECT url, failure_category FROM snapshots WHERE status = 'failed' AND trashed_at IS NULL`,
  );
  const counts = new Map<FailureGroupId, { count: number; hosts: Set<string> }>();
  for (const r of rows) {
    const g = groupOfCategory(r.failure_category);
    let entry = counts.get(g);
    if (!entry) {
      entry = { count: 0, hosts: new Set() };
      counts.set(g, entry);
    }
    entry.count++;
    const host = hostOf(r.url);
    if (host) entry.hosts.add(host);
  }
  return FAILURE_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    categories: g.categories,
    count: counts.get(g.id)?.count ?? 0,
    domains: counts.get(g.id)?.hosts.size ?? 0,
  }));
}

export interface FailureDomain {
  host: string;
  count: number;
  /** Of those, the pages that have a snapshot that worked (which stays whatever is decided here). */
  withWorkingSnapshot: number;
  lastFailedAt: string;
  example: { id: number; url: string };
}

/**
 * The domains of a group, most failed snapshots first, one page at a time. `q` keeps the domains that
 * contain it (case-insensitive): "mirrorsite" finds every mirror.
 */
export async function listFailureDomains(
  db: Db,
  groupId: string,
  options: { q?: string | undefined; page?: number; limit?: number } = {},
): Promise<{
  items: FailureDomain[];
  total: number;
  snapshots: number;
  page: number;
  limit: number;
} | null> {
  const group = failureGroup(groupId);
  if (!group) return null;
  const needle = options.q?.trim().toLowerCase() || undefined;
  const byHost = new Map<string, FailureDomain>();
  for (const row of await failedRows(db, group)) {
    const host = hostOf(row.url);
    if (!host || (needle && !host.includes(needle))) continue;
    let d = byHost.get(host);
    if (!d) {
      d = {
        host,
        count: 0,
        withWorkingSnapshot: 0,
        lastFailedAt: row.created_at,
        example: { id: row.id, url: row.url },
      };
      byHost.set(host, d);
    }
    d.count++;
    if (row.ok_id !== null) d.withWorkingSnapshot++;
    if (row.created_at > d.lastFailedAt) d.lastFailedAt = row.created_at;
  }
  const all = [...byHost.values()].sort(
    (a, b) => b.count - a.count || a.host.localeCompare(b.host),
  );
  const { page, limit, offset } = pageWindow(options.page ?? 1, options.limit ?? 50, 50);
  return {
    items: all.slice(offset, offset + limit),
    total: all.length,
    snapshots: all.reduce((n, d) => n + d.count, 0),
    page,
    limit,
  };
}

export interface FailedSnapshot {
  id: number;
  url: string;
  createdAt: string;
  category: string | null;
  detail: string | null;
  /** The newest snapshot of the same URL that worked, if any. */
  workingSnapshotId: number | null;
}

/**
 * The failed snapshots of a group, newest first, one page at a time: of one domain (`host`), of the
 * domains containing `q`, or all of them.
 */
export async function listFailedSnapshots(
  db: Db,
  groupId: string,
  host: string | undefined,
  options: { q?: string | undefined; page?: number; limit?: number } = {},
): Promise<{ items: FailedSnapshot[]; total: number; page: number; limit: number } | null> {
  const group = failureGroup(groupId);
  if (!group) return null;
  const wanted = host?.toLowerCase();
  const needle = options.q?.trim().toLowerCase() || undefined;
  const rows = (await failedRows(db, group)).filter((r) => {
    const h = hostOf(r.url) ?? "";
    return (!wanted || h === wanted) && (!needle || h.includes(needle));
  });
  const { page, limit, offset } = pageWindow(options.page ?? 1, options.limit ?? 50, 50);
  return {
    items: rows.slice(offset, offset + limit).map((r) => ({
      id: r.id,
      url: r.url,
      createdAt: r.created_at,
      category: r.failure_category,
      detail: r.failure_detail,
      workingSnapshotId: r.ok_id,
    })),
    total: rows.length,
    page,
    limit,
  };
}

/**
 * What a bulk decision applies to. Either explicit `hosts` and/or `ids`, or `all`: every failed snapshot of
 * the group, narrowed to the domains containing `q` (the filter the page shows) and to `host` (one domain's
 * page), so "select all N" never needs the ids on the client. `excludeHosts` and `excludeIds` take back
 * what was unticked after selecting all.
 */
export interface FailureSelection {
  hosts?: string[] | undefined;
  ids?: number[] | undefined;
  all?: boolean | undefined;
  q?: string | undefined;
  host?: string | undefined;
  excludeHosts?: string[] | undefined;
  excludeIds?: number[] | undefined;
}

/**
 * The failed snapshots of a group that a bulk decision applies to. Ids outside the group (another reason,
 * archived since, in the trash) are dropped, so a stale page can never act on a snapshot that is no
 * longer a failure of this kind.
 */
export async function failureGroupSnapshotIds(
  db: Db,
  groupId: string,
  selection: FailureSelection,
): Promise<number[] | null> {
  const group = failureGroup(groupId);
  if (!group) return null;
  const lower = (hs?: string[]) => new Set((hs ?? []).map((h) => h.toLowerCase()));
  const hosts = lower(selection.hosts);
  const ids = new Set(selection.ids ?? []);
  const excludeHosts = lower(selection.excludeHosts);
  const excludeIds = new Set(selection.excludeIds ?? []);
  const needle = selection.q?.trim().toLowerCase() || undefined;
  const onlyHost = selection.host?.toLowerCase();
  return (await failedRows(db, group))
    .filter((r) => {
      const host = hostOf(r.url) ?? "";
      const picked = selection.all
        ? (!needle || host.includes(needle)) && (!onlyHost || host === onlyHost)
        : ids.has(r.id) || hosts.has(host);
      return picked && !excludeHosts.has(host) && !excludeIds.has(r.id);
    })
    .map((r) => r.id);
}
