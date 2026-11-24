import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  type Db,
  FAILURE_GROUPS,
  addUrl,
  blockPageReason,
  createStorageBackend,
  deleteSnapshot,
  getSnapshot,
  hostOf,
  openDb,
} from "@webfrost/core";
import type { Command, Context } from "../cli";
import { CliError, UsageError } from "../errors";
import { isInteractive } from "../prompt";
import { safeText } from "../sanitize";
import {
  UploadError,
  exportBundle,
  formatBytes,
  printable,
  requireApiKey,
  serverBase,
  upload,
} from "./push";
import { printJson } from "./shared";

/**
 * `webfrost rescue <group> --from <server>`: archive here what the server could not, and swap each
 * failure for the working copy. Every copy is checked before it is sent (done, real text, no anti-bot
 * wall), and the server swaps it in one transaction only while the failure is still a failure of the
 * same URL (`POST /snapshots/import?replaces=`), so a stale list, a second run or a crash halfway never
 * stores a duplicate or replaces the wrong snapshot. What was rescued leaves the group, so running it
 * again goes on with what is left.
 */

const PATH = ["rescue"];

interface Failed {
  id: number;
  url: string;
  host: string;
}

type Outcome =
  /** The copy is on the server and the failure is in its trash. */
  | "rescued"
  /** Fails here too, for a reason a retry may fix (blocked, rate limited, timeouts...). */
  | "still-failing"
  /** Here the page answers 404/410, or the domain does not resolve: it really is gone. */
  | "gone"
  /** Archived, but what came back is an anti-bot or login wall: not sent. */
  | "wall"
  /** The server no longer has it as a failure (retried, archived or trashed since): not sent. */
  | "skipped"
  /** Not tried: the domain failed every time already (--give-up-after). */
  | "not-tried"
  /** Could not be exported or sent. */
  | "error";

interface Result {
  id: number;
  url: string;
  outcome: Outcome;
  /** The server's new snapshot, when rescued. */
  remoteId?: number;
  /** Why, for everything but "rescued". */
  reason?: string;
}

const LABELS: Record<Outcome, string> = {
  rescued: "rescued",
  "still-failing": "still failing here",
  gone: "really gone",
  wall: "anti-bot or login wall, not sent",
  skipped: "no longer a failure on the server",
  "not-tried": "not tried (domain gave up)",
  error: "could not be sent",
};

/** A request to the server's API, with the key, never following a redirect. */
async function api<T>(base: URL, apiKey: string, path: string): Promise<T> {
  const url = `${base.href.replace(/\/+$/, "")}/api/v1${path}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${apiKey}` }, redirect: "manual" });
  } catch (err) {
    throw new CliError(
      `cannot reach ${base.origin}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (res.status === 401) throw new CliError("the server rejected WEBFROST_API_KEY (HTTP 401)");
  if (res.status >= 300 && res.status < 400) {
    throw new CliError(
      `the server answered with a redirect (HTTP ${res.status}); pass its final URL to --from`,
    );
  }
  if (!res.ok) throw new CliError(`GET ${path} failed: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Every failed snapshot of the group on the server, narrowed like the web UI (`q`, one `host`). */
async function listFailures(
  base: URL,
  apiKey: string,
  group: string,
  q: string | undefined,
  host: string | undefined,
): Promise<Failed[]> {
  const seen = new Set<number>();
  const out: Failed[] = [];
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({ page: String(page), limit: "200" });
    if (q) params.set("q", q);
    if (host) params.set("host", host);
    const res = await api<{ items: { id: number; url: string }[]; total: number }>(
      base,
      apiKey,
      `/failures/${group}/snapshots?${params}`,
    );
    for (const s of res.items) {
      // Pages are by offset: a snapshot that moved between two pages is listed once.
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push({ id: s.id, url: s.url, host: hostOf(s.url) ?? "" });
    }
    if (res.items.length === 0 || page * 200 >= res.total) break;
  }
  return out;
}

async function confirm(question: string): Promise<boolean> {
  process.stderr.write(`${question} [y/N] `);
  for await (const line of console) return /^y(es)?$/i.test(line.trim());
  return false;
}

/** Archive `url` in the scratch archive and say whether the copy is worth sending. */
async function archiveHere(
  ctx: Context,
  db: Db,
  workDir: string,
  url: string,
  minText: number,
): Promise<{ localId: number; outcome: Outcome | "ok"; reason?: string }> {
  const quiet = {
    debug: () => {},
    info: () => {},
    warn: (m: string) => ctx.verbose && ctx.logger.warn(m),
    error: (m: string) => ctx.verbose && ctx.logger.error(m),
  };
  const localId = await addUrl(db, url, workDir, ctx.verbose ? ctx.logger : quiet);
  const snap = await getSnapshot(db, localId);
  if (!snap) return { localId, outcome: "error", reason: "the local snapshot was not recorded" };
  if (snap.status !== "done") {
    const category = snap.failure_category ?? "error";
    const reason = safeText(snap.failure_detail ?? category);
    const gone = category === "page_not_found" || category === "domain_not_found";
    return { localId, outcome: gone ? "gone" : "still-failing", reason };
  }
  const readability = snap.archiveResults.find(
    (r) => r.extractor === "readability" && r.error === null,
  );
  let title: string | null = null;
  let text: string | null = null;
  try {
    const parsed = JSON.parse(readability?.content ?? "{}") as {
      title?: unknown;
      textContent?: unknown;
    };
    title = typeof parsed.title === "string" ? parsed.title : null;
    text = typeof parsed.textContent === "string" ? parsed.textContent : null;
  } catch {
    // No readable text: judged as an empty page below.
  }
  const wall = blockPageReason(title, text, minText);
  if (wall) return { localId, outcome: "wall", reason: wall };
  return { localId, outcome: "ok" };
}

export const rescueCommand: Command = {
  kind: "command",
  name: "rescue",
  summary: "Archive here what a server could not, and replace its failures",
  description:
    "For each failed snapshot of a group on a WebFrost server (as in Review failures), archive the page on this machine, check the copy (done, real text, no anti-bot or login wall) and send it to the server, which stores it and moves the failure to its trash in one step. Copies that fail the check are not sent. Safe to run again: what was rescued is no longer in the group, and the server refuses a copy whose failure was retried, archived or trashed since.",
  args: [
    {
      name: "group",
      description: `The failure group: ${FAILURE_GROUPS.map((g) => g.id).join(", ")}`,
    },
  ],
  options: {
    from: {
      type: "string",
      value: "url",
      description: "The server's base URL, e.g. https://archive.example.com",
    },
    host: { type: "string", value: "domain", description: "Only this domain" },
    q: { type: "string", value: "text", description: "Only domains containing this text" },
    limit: { type: "string", value: "n", description: "At most this many snapshots" },
    "give-up-after": {
      type: "string",
      value: "n",
      description:
        "Skip the rest of a domain after this many failures in a row here (default 3, 0 = never)",
    },
    "min-text": {
      type: "string",
      value: "chars",
      description: "Readable text a copy needs to be sent (default 150; 0 = no minimum)",
    },
    concurrency: {
      type: "string",
      value: "n",
      description: "Domains worked on at the same time (default 2; one page at a time per domain)",
    },
    "dry-run": { type: "boolean", description: "List what would be tried, then stop" },
    yes: { type: "boolean", short: "y", description: "Do not ask before starting" },
    insecure: {
      type: "boolean",
      description: "Allow a plain-HTTP --from URL that is not this machine",
    },
    json: { type: "boolean", description: "Print JSON: { summary, results } at the end" },
  },
  notes: `
The pages are archived in a scratch archive (rescue/ in the data directory),
not your own, and each copy is deleted there once it was sent or rejected.

Environment:
  WEBFROST_API_KEY  An API key of the server (Settings > API keys).

Exit codes:
  0  it ran to the end (pages that still fail are reported, not an error)
  1  at least one copy could not be sent
  2  usage error`,
  examples: [
    "webfrost rescue blocked --from https://archive.example.com --dry-run",
    "webfrost rescue blocked --from https://archive.example.com --q kabum",
    "webfrost rescue rate-limited --from https://archive.example.com --yes --json",
  ],
  async run(ctx) {
    const group = ctx.args[0] ?? "";
    const info = FAILURE_GROUPS.find((g) => g.id === group);
    if (!info) {
      throw new UsageError(
        `Unknown group "${group}". One of: ${FAILURE_GROUPS.map((g) => g.id).join(", ")}.`,
        PATH,
      );
    }
    const base = serverBase(ctx, ctx.string("from"), "from", PATH);
    const apiKey = requireApiKey("rescue");
    const limit = ctx.int("limit", { min: 1 });
    const giveUpAfter = ctx.int("give-up-after", { min: 0 }) ?? 3;
    const minText = ctx.int("min-text", { min: 0 }) ?? 150;
    const concurrency = ctx.int("concurrency", { min: 1, max: 8 }) ?? 2;
    const json = ctx.bool("json");
    const say = (msg: string) => {
      if (!ctx.quiet) process.stderr.write(`${msg}\n`);
    };

    let failures = await listFailures(base, apiKey, group, ctx.string("q"), ctx.string("host"));
    if (limit) failures = failures.slice(0, limit);
    const byHost = new Map<string, Failed[]>();
    for (const f of failures) byHost.set(f.host, [...(byHost.get(f.host) ?? []), f]);

    say(
      `${failures.length} failed snapshot${failures.length === 1 ? "" : "s"} across ${byHost.size} domain${byHost.size === 1 ? "" : "s"} in "${info.label}" on ${base.origin}.`,
    );
    if (failures.length === 0) {
      if (json) printJson({ summary: {}, results: [] });
      return 0;
    }
    if (ctx.bool("dry-run")) {
      const rows = [...byHost]
        .map(([host, list]) => ({ host, count: list.length }))
        .sort((a, b) => b.count - a.count || a.host.localeCompare(b.host));
      if (json) printJson({ domains: rows });
      else for (const r of rows) console.log(`${r.count}\t${r.host}`);
      return 0;
    }
    if (!ctx.bool("yes")) {
      if (!isInteractive()) {
        throw new UsageError("Pass --yes to start without a prompt (or --dry-run to look).", PATH);
      }
      if (!(await confirm("Archive them here and replace each one that works?"))) {
        say("Nothing done.");
        return 0;
      }
    }

    const workDir = join(ctx.dir, "rescue");
    mkdirSync(workDir, { recursive: true });
    const db = await openDb(workDir);
    const storage = createStorageBackend(workDir);
    const endpoint = `${base.href.replace(/\/+$/, "")}/api/v1/snapshots/import`;
    const results: Result[] = [];
    let stopping = false;
    let fatal: string | undefined;
    ctx.onSignal(() => {
      stopping = true;
      say("Stopping after the pages in progress (Ctrl+C again to quit now)...");
    });

    const record = (r: Result) => {
      results.push(r);
      const n = `[${results.length}/${failures.length}]`;
      const tail = r.outcome === "rescued" ? `snapshot ${r.remoteId}` : (r.reason ?? "");
      say(`${n} ${LABELS[r.outcome]}: ${safeText(r.url)}${tail ? ` (${printable(tail)})` : ""}`);
    };

    async function rescueOne(f: Failed): Promise<Outcome> {
      let localId: number | undefined;
      try {
        const here = await archiveHere(ctx, db, workDir, f.url, minText);
        localId = here.localId;
        if (here.outcome !== "ok") {
          record({
            id: f.id,
            url: f.url,
            outcome: here.outcome,
            ...(here.reason ? { reason: here.reason } : {}),
          });
          return here.outcome;
        }
        const bundle = join(workDir, `rescue-${localId}.zip`);
        try {
          const bytes = await exportBundle({ ...ctx, dir: workDir }, localId, bundle);
          const remote = await upload(
            ctx,
            `${endpoint}?replaces=${f.id}`,
            apiKey,
            localId,
            bundle,
            bytes,
          );
          record({
            id: f.id,
            url: f.url,
            outcome: "rescued",
            remoteId: remote.id,
            reason: formatBytes(bytes),
          });
          return "rescued";
        } finally {
          rmSync(bundle, { force: true });
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        if (err instanceof UploadError && err.status === 409) {
          record({ id: f.id, url: f.url, outcome: "skipped", reason });
          return "skipped";
        }
        // Nothing more can be sent with a rejected key or to a server that cannot be reached.
        if (err instanceof UploadError && (err.status === 401 || err.status === 0)) fatal = reason;
        record({ id: f.id, url: f.url, outcome: "error", reason });
        return "error";
      } finally {
        if (localId !== undefined) {
          await deleteSnapshot(db, localId, storage).catch(() => {});
        }
      }
    }

    // One page at a time per domain (the pipeline also spaces requests to a domain), a few
    // domains at once.
    const queue = [...byHost.values()];
    async function worker() {
      for (let list = queue.shift(); list; list = queue.shift()) {
        let inARow = 0;
        for (const [i, f] of list.entries()) {
          if (stopping || fatal) return;
          if (giveUpAfter > 0 && inARow >= giveUpAfter) {
            for (const rest of list.slice(i)) {
              record({
                id: rest.id,
                url: rest.url,
                outcome: "not-tried",
                reason: `the last ${inARow} failed here`,
              });
            }
            break;
          }
          const outcome = await rescueOne(f);
          inARow = outcome === "still-failing" || outcome === "wall" ? inARow + 1 : 0;
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: concurrency }, worker));
    } finally {
      await db.close();
    }

    const summary: Partial<Record<Outcome, number>> = {};
    for (const r of results) summary[r.outcome] = (summary[r.outcome] ?? 0) + 1;
    if (json) {
      printJson({ summary, results });
    } else {
      say("");
      for (const o of Object.keys(LABELS) as Outcome[]) {
        if (summary[o]) say(`${String(summary[o]).padStart(6)}  ${LABELS[o]}`);
      }
      const left = failures.length - results.length;
      if (left > 0) say(`${String(left).padStart(6)}  not reached (stopped)`);
      if (summary.gone) {
        say(
          `\nThe pages that are really gone stay in "${info.label}" on the server: trash them there, in Review failures.`,
        );
      }
    }
    if (fatal) throw new CliError(fatal);
    return summary.error ? 1 : 0;
  },
};
