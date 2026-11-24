import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  type Db,
  FAILURE_GROUPS,
  FilesystemBackend,
  type StorageBackend,
  addUrl,
  blockPageReason,
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
  /** Archived without the browser formats (no Chromium here, or the browser failed): not sent. */
  | "incomplete"
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
  incomplete: "browser formats failed here, not sent",
  skipped: "no longer a failure on the server",
  "not-tried": "not tried (domain gave up)",
  error: "could not be sent",
};

/** A request to the server's API, with the key, never following a redirect. */
async function api<T>(base: URL, apiKey: string, path: string, body?: unknown): Promise<T> {
  const url = `${base.href.replace(/\/+$/, "")}/api/v1${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        authorization: `Bearer ${apiKey}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
      redirect: "manual",
    });
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
  if (!res.ok)
    throw new CliError(`${body === undefined ? "GET" : "POST"} ${path} failed: HTTP ${res.status}`);
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
/** The title and visible text of the DOM the browser rendered (what the screenshot and PDF show). */
function renderedPage(html: string): { title: string | null; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const text = body
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { title, text };
}

async function archiveHere(
  ctx: Context,
  db: Db,
  storage: StorageBackend,
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
  const localId = await addUrl(db, url, workDir, ctx.verbose ? ctx.logger : quiet, storage);
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

  // The HTML above is what the plain fetch got; a challenge may only appear once its scripts run. The
  // browser's DOM is what the screenshot, PDF and SingleFile copy show, so it must be there and be the
  // page too. Without it (no Chromium here) the copy would lack the formats the server failed to make.
  const dom = snap.archiveResults.find((r) => r.extractor === "dom-snapshot");
  if (!dom || dom.error !== null || !dom.content) {
    return {
      localId,
      outcome: "incomplete",
      reason: safeText(dom?.error ?? "no DOM snapshot (is Chromium installed? webfrost doctor)"),
    };
  }
  let rendered: { title: string | null; text: string };
  try {
    rendered = renderedPage(new TextDecoder().decode(await storage.getBytes(dom.content)));
  } catch {
    return { localId, outcome: "incomplete", reason: "the DOM snapshot could not be read" };
  }
  const renderedWall = blockPageReason(rendered.title, rendered.text, minText);
  if (renderedWall) return { localId, outcome: "wall", reason: `in the browser, ${renderedWall}` };
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
    keep: {
      type: "boolean",
      description: "Keep the scratch archive (rescue/) at the end, to look at what was rejected",
    },
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
    const keep = ctx.bool("keep");
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

    // The scratch archive is SQLite and files under rescue/, whatever this shell points WebFrost at: with
    // DATABASE_URL or S3 settings it would otherwise write (and delete, by id) in a real archive. This
    // process runs only this command, so its environment can be pinned for the rest of it.
    Reflect.deleteProperty(process.env, "DATABASE_URL");
    process.env.WEBFROST_STORAGE_BACKEND = "filesystem";
    const workDir = join(ctx.dir, "rescue");
    // Leftovers of a run that was killed (and a dead-domain memory that would answer for DNS) go first.
    rmSync(workDir, { recursive: true, force: true });
    mkdirSync(workDir, { recursive: true });
    const db = await openDb(workDir);
    const storage = new FilesystemBackend(join(workDir, "snapshots"));
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

    /** Upload, waiting out a busy server (it runs two imports at a time) a few times. */
    async function send(f: Failed, localId: number, bundle: string, bytes: number) {
      for (let attempt = 1; ; attempt++) {
        try {
          return await upload(ctx, `${endpoint}?replaces=${f.id}`, apiKey, localId, bundle, bytes);
        } catch (err) {
          if (!(err instanceof UploadError) || err.status !== 429 || attempt >= 5 || stopping) {
            throw err;
          }
          await Bun.sleep((err.retryAfter ?? 10 * attempt) * 1000);
        }
      }
    }

    /**
     * One page: archive it once, send it once in place of `f`, and give the same verdict to `twins`,
     * the other failures of the same URL (a schedule that failed several times), which go to the trash
     * once the copy is in: one working snapshot stands for all of them.
     */
    async function rescueOne(f: Failed, twins: Failed[]): Promise<Outcome> {
      const all = [f, ...twins];
      const verdict = (r: Omit<Result, "id" | "url">) => {
        for (const x of all) record({ id: x.id, url: x.url, ...r });
      };
      let localId: number | undefined;
      try {
        const here = await archiveHere(ctx, db, storage, workDir, f.url, minText);
        localId = here.localId;
        if (here.outcome !== "ok") {
          verdict({ outcome: here.outcome, ...(here.reason ? { reason: here.reason } : {}) });
          return here.outcome;
        }
        const bundle = join(workDir, `rescue-${localId}.zip`);
        try {
          const bytes = await exportBundle({ dir: workDir }, localId, bundle, storage);
          const remote = await send(f, localId, bundle, bytes);
          record({
            id: f.id,
            url: f.url,
            outcome: "rescued",
            remoteId: remote.id,
            reason: formatBytes(bytes),
          });
          if (twins.length > 0) {
            await api(base, apiKey, `/failures/${group}/trash`, { ids: twins.map((t) => t.id) });
            for (const t of twins) {
              record({
                id: t.id,
                url: t.url,
                outcome: "rescued",
                remoteId: remote.id,
                reason: `same page as snapshot ${f.id}, moved to the trash`,
              });
            }
          }
          return "rescued";
        } finally {
          rmSync(bundle, { force: true });
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        const done = new Set(results.map((r) => r.id));
        const left = all.filter((x) => !done.has(x.id));
        if (err instanceof UploadError && err.status === 409) {
          for (const x of left) record({ id: x.id, url: x.url, outcome: "skipped", reason });
          return "skipped";
        }
        // Nothing more can be sent with a rejected key or to a server that cannot be reached.
        if (err instanceof UploadError && (err.status === 401 || err.status === 0)) fatal = reason;
        for (const x of left) record({ id: x.id, url: x.url, outcome: "error", reason });
        return "error";
      } finally {
        if (localId !== undefined && !keep) {
          await deleteSnapshot(db, localId, storage).catch(() => {});
        }
      }
    }

    // One page at a time per domain (the pipeline also spaces requests to a domain), a few
    // domains at once. Failures of the same URL are archived and sent once.
    const queue = [...byHost.values()].map((list) => {
      const byUrl = new Map<string, Failed[]>();
      for (const f of list) byUrl.set(f.url, [...(byUrl.get(f.url) ?? []), f]);
      return [...byUrl.values()];
    });
    async function worker() {
      for (let pages = queue.shift(); pages; pages = queue.shift()) {
        let inARow = 0;
        for (const [i, [first, ...twins]] of pages.entries()) {
          if (stopping || fatal || !first) return;
          if (giveUpAfter > 0 && inARow >= giveUpAfter) {
            for (const rest of pages.slice(i).flat()) {
              record({
                id: rest.id,
                url: rest.url,
                outcome: "not-tried",
                reason: `the last ${inARow} failed here`,
              });
            }
            break;
          }
          const outcome = await rescueOne(first, twins);
          inARow = ["still-failing", "wall", "incomplete"].includes(outcome) ? inARow + 1 : 0;
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: concurrency }, worker));
    } finally {
      await db.close();
      if (!keep) rmSync(workDir, { recursive: true, force: true });
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
    if (stopping) return 130;
    return summary.error ? 1 : 0;
  },
};
