import {
  addUrl,
  createStorageBackend,
  deleteSnapshot,
  getSnapshot,
  listSnapshotsWithExtractorsPaginated,
  rebuildIndex,
  searchSnapshots,
} from "@webfrost/core";
import { type Command, parseHttpUrl, parseId } from "../cli";
import { CliError } from "../errors";
import { hint, printJson, withDb } from "./shared";

export const initCommand: Command = {
  kind: "command",
  name: "init",
  summary: "Create the archive (database) in the data directory",
  description:
    "Create the archive in the data directory (WEBFROST_DIR, default ~/.webfrost). Every other command does this on first use, so init is optional.",
  examples: ["webfrost init", "WEBFROST_DIR=./data webfrost init"],
  async run(ctx) {
    await withDb(ctx, () => {});
    ctx.logger.info(`Archive initialized at ${ctx.dir}`);
    return 0;
  },
};

export const addCommand: Command = {
  kind: "command",
  name: "add",
  summary: "Archive a URL",
  description:
    "Fetch a page and run every extractor on it (HTML, WARC, Readability, screenshot, PDF, DOM, SingleFile, media).",
  args: [{ name: "url", description: "An http or https URL" }],
  options: {
    json: {
      type: "boolean",
      description: "Print the result as JSON on stdout (logs go to stderr)",
    },
  },
  notes: `
Exit codes:
  0  the snapshot finished with status "done": at least one extractor produced output.
     Individual extractors may still have failed (for example the screenshot when no
     Chromium is installed); --json lists each extractor's outcome.
  1  the snapshot ended "failed": the page could not be fetched (network error or
     HTTP status 400 or above) or no extractor produced anything.
  2  usage error.`,
  examples: ["webfrost add https://example.com", "webfrost add https://example.com --json"],
  async run(ctx) {
    const url = ctx.args[0] ?? "";
    parseHttpUrl(url, ["add"]);
    ctx.logger.info(`Archiving ${url}...`);
    const snapshot = await withDb(ctx, async (db) => {
      const id = await addUrl(db, url, ctx.dir, ctx.logger);
      return getSnapshot(db, id);
    });
    if (!snapshot) throw new CliError("The snapshot was not recorded.");
    const done = snapshot.status === "done";
    if (ctx.bool("json")) {
      printJson({
        id: snapshot.id,
        url: snapshot.url,
        status: snapshot.status,
        extractors: snapshot.archiveResults.map((r) => ({
          name: r.extractor,
          ok: r.error === null,
          error: r.error,
        })),
      });
    }
    if (done) {
      ctx.logger.info(`Snapshot ${snapshot.id} archived.`);
      return 0;
    }
    const reasons = [...new Set(snapshot.archiveResults.map((r) => r.error).filter(Boolean))];
    ctx.logger.error(
      `Snapshot ${snapshot.id} finished with status: ${snapshot.status}${
        reasons.length ? ` (${reasons.slice(0, 3).join("; ")})` : ""
      }`,
    );
    return 1;
  },
};

export const listCommand: Command = {
  kind: "command",
  name: "list",
  summary: "List snapshots, newest first",
  options: {
    status: {
      type: "string",
      value: "status",
      description: "Only snapshots with this status (pending, running, done, failed)",
    },
    limit: { type: "string", value: "n", description: "How many to show (default 50)" },
    page: { type: "string", value: "n", description: "Page of results, starting at 1" },
    json: { type: "boolean", description: "Print JSON: { items, total, page, limit }" },
  },
  examples: ["webfrost list --status failed", "webfrost list --limit 10 --json"],
  async run(ctx) {
    const limit = ctx.int("limit", { min: 1, max: 1000 }) ?? 50;
    const page = ctx.int("page", { min: 1 }) ?? 1;
    const status = ctx.string("status");
    const result = await withDb(ctx, (db) =>
      listSnapshotsWithExtractorsPaginated(db, page, limit, status),
    );
    if (ctx.bool("json")) {
      printJson(result);
      return 0;
    }
    for (const s of result.items) console.log(`${s.id}\t${s.status}\t${s.url}`);
    const shown = (page - 1) * limit + result.items.length;
    if (shown < result.total) {
      hint(ctx, `Showing ${shown} of ${result.total}. Use --page ${page + 1} for more.`);
    }
    return 0;
  },
};

export const deleteCommand: Command = {
  kind: "command",
  name: "delete",
  summary: "Delete a snapshot and its files",
  args: [{ name: "id", description: "Snapshot id (see `webfrost list`)" }],
  examples: ["webfrost delete 12"],
  async run(ctx) {
    const id = parseId(ctx.args[0] ?? "", "snapshot id", ["delete"]);
    const deleted = await withDb(ctx, (db) =>
      deleteSnapshot(db, id, createStorageBackend(ctx.dir)),
    );
    if (!deleted) throw new CliError(`Snapshot ${id} not found.`);
    ctx.logger.info(`Snapshot ${id} deleted.`);
    return 0;
  },
};

/** Search snippets are HTML (escaped text + <mark> highlights); the terminal wants plain text. */
export function plainSnippet(snippet: string): string {
  return snippet
    .replace(/<\/?mark>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export const searchCommand: Command = {
  kind: "command",
  name: "search",
  summary: "Full-text search across archived content",
  args: [
    { name: "query", description: "Search terms (several words are one query)", variadic: true },
  ],
  options: {
    limit: { type: "string", value: "n", description: "Results per page (default 20)" },
    page: { type: "string", value: "n", description: "Page of results, starting at 1" },
    json: { type: "boolean", description: "Print JSON: { items, total, page, limit }" },
  },
  examples: ['webfrost search "example domain"', "webfrost search archiving --limit 5 --json"],
  async run(ctx) {
    const query = ctx.args.join(" ");
    const limit = ctx.int("limit", { min: 1, max: 100 }) ?? 20;
    const page = ctx.int("page", { min: 1 }) ?? 1;
    const results = await withDb(ctx, (db) => searchSnapshots(db, query, limit, page));
    if (ctx.bool("json")) {
      printJson({
        ...results,
        items: results.items.map((r) => ({
          ...r,
          snippet: r.snippet ? plainSnippet(r.snippet) : r.snippet,
        })),
      });
      return 0;
    }
    if (results.items.length === 0) console.log("No results.");
    for (const r of results.items) {
      console.log(`${r.id}\t${r.url}`);
      if (r.snippet) console.log(`  ${plainSnippet(r.snippet)}`);
    }
    const shown = (results.page - 1) * results.limit + results.items.length;
    if (shown < results.total) {
      hint(ctx, `Showing ${shown} of ${results.total}. Use --page ${results.page + 1} for more.`);
    }
    return 0;
  },
};

export const searchRebuildCommand: Command = {
  kind: "command",
  name: "search:rebuild",
  summary: "Rebuild the full-text search index",
  async run(ctx) {
    await withDb(ctx, (db) => rebuildIndex(db));
    ctx.logger.info("Search index rebuilt.");
    return 0;
  },
};
