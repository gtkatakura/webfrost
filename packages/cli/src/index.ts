// @webfrost/cli entry point
import { readFileSync } from "node:fs";
import {
  JobRunner,
  SCHEDULER_INTERVAL_MS,
  addRssFeedSchedule,
  addSchedule,
  addTagToSnapshot,
  addUrl,
  createAdminUser,
  createApiKey,
  createStorageBackend,
  createTag,
  deleteSnapshot,
  deleteTag,
  detectFormat,
  getSnapshot,
  getTag,
  isUrlArchived,
  listApiKeys,
  listSchedules,
  listSnapshotTags,
  listSnapshots,
  listTags,
  openDb,
  parseUrls,
  rebuildIndex,
  removeSchedule,
  revokeApiKey,
  safeFetch,
  searchSnapshots,
  startScheduler,
} from "@webfrost/core";
import { createLogger, resolveLogLevel } from "./logger";

const archiveDir = process.env.WEBFROST_DIR ?? process.cwd();
const command = process.argv[2];

// Parse global flags from all trailing args before the command's own args.
// --verbose / --quiet are stripped before passing args to each command handler.
const rawArgs = process.argv.slice(3);
const verbose = rawArgs.includes("--verbose");
const quiet = rawArgs.includes("--quiet");
const args = rawArgs.filter((a) => a !== "--verbose" && a !== "--quiet");

const logger = createLogger(resolveLogLevel({ verbose, quiet }));

// Read version from package.json
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url).pathname, "utf8"),
) as { version: string };

/** Search snippets are HTML (escaped text + <mark> highlights); the terminal wants plain text. */
function plainSnippet(snippet: string): string {
  return snippet
    .replace(/<\/?mark>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function printHelp(): void {
  console.log(`webfrost v${version} — self-hosted web archiving toolkit

Usage: webfrost <command> [options]

Commands:
  init                        Initialize a new archive in the current directory
  add <url>                   Archive a URL
  list                        List all snapshots
  delete <id>                 Delete a snapshot by ID
  search <query>              Full-text search across archived content
  search:rebuild              Rebuild the full-text search index

  schedule add <url> --cron <expr>               Schedule a URL for periodic archiving
  schedule add --rss <feed-url> --cron <expr>    Schedule an RSS feed for periodic archiving
  schedule list                                  List all schedules
  schedule remove <id>                           Remove a schedule by ID
  schedule worker                                Start the schedule polling worker

  import [--format=<fmt>] <url-or-file>          Bulk import URLs from a file or URL
                                                 Formats: rss, opml, netscape, text

  tag add <snapshot-id> <name>                   Tag a snapshot
  tag list [<snapshot-id>]                       List all tags (or tags on a snapshot)
  tag create <name> [--color <hex>]              Create a new tag
  tag remove <tag-id>                            Delete a tag

  admin create --username <name> --password <pass>    Create an admin user
  admin key create --name <label> [--expires <date>]  Create an API key
  admin key list                                      List all API keys
  admin key revoke <id>                               Revoke an API key

Flags:
  --help, -h      Show help
  --version, -v   Show version
  --verbose       Enable debug-level output
  --quiet         Suppress info output (warn/error only)

Environment:
  WEBFROST_DIR              Archive directory (default: current working directory)
  WEBFROST_LOG_LEVEL        Log level: debug | info | warn | error (default: info)
  WEBFROST_CONCURRENCY      Pipelines run in parallel by import / schedule worker (default: 3)
  WEBFROST_DOMAIN_DELAY_MS  Minimum gap between two archives of the same host (default: 1000)

Examples:
  webfrost init
  webfrost add https://example.com
  webfrost search "web archiving"
  webfrost schedule add https://example.com --cron "0 * * * *"
`);
}

function printScheduleHelp(): void {
  console.log(`Usage: webfrost schedule <subcommand> [options]

Subcommands:
  add <url> --cron <expr>               Schedule a URL for periodic archiving
  add --rss <feed-url> --cron <expr>    Schedule an RSS feed for periodic archiving
  list                                  List all schedules
  remove <id>                           Remove a schedule by ID
  worker                                Start the schedule polling worker (polls every 30s)
`);
}

function printTagHelp(): void {
  console.log(`Usage: webfrost tag <subcommand> [options]

Subcommands:
  add <snapshot-id> <name>         Tag a snapshot
  list [<snapshot-id>]             List all tags, or tags on a specific snapshot
  create <name> [--color <hex>]    Create a new tag
  remove <tag-id>                  Delete a tag and remove it from all snapshots
`);
}

function printAdminHelp(): void {
  console.log(`Usage: webfrost admin <subcommand> [options]

Subcommands:
  create --username <name> --password <pass>    Create an admin user
  key create --name <label> [--expires <date>]  Create an API key
  key list                                      List all active API keys
  key revoke <id>                               Revoke an API key
`);
}

// Handle top-level flags before dispatching
if (command === "--help" || command === "-h" || command === undefined) {
  printHelp();
  process.exit(0);
}

if (command === "--version" || command === "-v") {
  console.log(`webfrost v${version}`);
  process.exit(0);
}

switch (command) {
  case "init": {
    openDb(archiveDir).close();
    logger.info(`Archive initialized at ${archiveDir}`);
    break;
  }

  case "add": {
    const url = args[0];
    if (!url) {
      logger.error("Usage: webfrost add <url>");
      process.exit(1);
    }
    let parsedAdd: URL;
    try {
      parsedAdd = new URL(url);
    } catch {
      logger.error("Invalid URL");
      process.exit(1);
    }
    if (parsedAdd.protocol !== "http:" && parsedAdd.protocol !== "https:") {
      logger.error("Only http/https URLs are supported");
      process.exit(1);
    }
    const db = openDb(archiveDir);
    logger.info(`Archiving ${url}...`);
    const snapshotId = await addUrl(db, url, archiveDir, logger);
    const snap = db
      .query<{ status: string }, [number]>("SELECT status FROM snapshots WHERE id = ?")
      .get(snapshotId);
    db.close();
    if (snap?.status === "done") {
      logger.info(`Snapshot ${snapshotId} archived.`);
    } else {
      logger.warn(`Snapshot ${snapshotId} finished with status: ${snap?.status ?? "unknown"}`);
    }
    break;
  }

  case "list": {
    const db = openDb(archiveDir);
    const snapshots = listSnapshots(db);
    db.close();
    for (const s of snapshots) {
      console.log(`${s.id}\t${s.status}\t${s.url}`);
    }
    break;
  }

  case "schedule": {
    const sub = args[0];

    if (sub === "--help" || sub === "-h") {
      printScheduleHelp();
      process.exit(0);
    }

    if (sub === "add") {
      // webfrost schedule add <url> --cron <expr>
      // webfrost schedule add --rss <feed-url> --cron <expr>
      const rssIdx = args.indexOf("--rss");
      const isRss = rssIdx !== -1;
      const urlArg = isRss ? args[rssIdx + 1] : args[1];
      const cronIdx = args.indexOf("--cron");
      const cronExpr = cronIdx !== -1 ? args[cronIdx + 1] : undefined;

      if (!urlArg || !cronExpr) {
        if (isRss) {
          logger.error("Usage: webfrost schedule add --rss <feed-url> --cron <expr>");
        } else {
          logger.error("Usage: webfrost schedule add <url> --cron <expr>");
        }
        process.exit(1);
      }

      let parsedSchedule: URL;
      try {
        parsedSchedule = new URL(urlArg);
      } catch {
        logger.error("Invalid URL");
        process.exit(1);
      }
      if (parsedSchedule.protocol !== "http:" && parsedSchedule.protocol !== "https:") {
        logger.error("Only http/https URLs are supported");
        process.exit(1);
      }

      const db = openDb(archiveDir);
      try {
        const id = isRss
          ? addRssFeedSchedule(db, urlArg, cronExpr)
          : addSchedule(db, urlArg, cronExpr);
        const label = isRss ? "RSS feed schedule" : "Schedule";
        logger.info(`${label} ${id} created: ${urlArg} @ ${cronExpr}`);
      } finally {
        db.close();
      }
      break;
    }

    if (sub === "list") {
      const db = openDb(archiveDir);
      try {
        const schedules = listSchedules(db);
        if (schedules.length === 0) {
          console.log("No schedules.");
        }
        for (const s of schedules) {
          const last = s.last_run_at ?? "never";
          const kindLabel = s.kind === "rss_feed" ? "[rss]" : "[url]";
          console.log(
            `${s.id}\t${kindLabel}\t${s.cron}\t${s.url}\tlast:${last}\tnext:${s.next_run_at}`,
          );
        }
      } finally {
        db.close();
      }
      break;
    }

    if (sub === "remove") {
      const idArg = args[1];
      if (!idArg) {
        logger.error("Usage: webfrost schedule remove <id>");
        process.exit(1);
      }
      const id = Number(idArg);
      if (!Number.isInteger(id) || id <= 0) {
        logger.error("Invalid schedule id");
        process.exit(1);
      }
      const db = openDb(archiveDir);
      try {
        const removed = removeSchedule(db, id);
        if (removed) {
          logger.info(`Schedule ${id} removed.`);
        } else {
          logger.error(`Schedule ${id} not found.`);
          process.exit(1);
        }
      } finally {
        db.close();
      }
      break;
    }

    if (sub === "worker") {
      // Polling worker: the same scheduler the HTTP server embeds. Due schedules are
      // claimed atomically, so running this next to a server on the same archive is
      // safe (set WEBFROST_SCHEDULER=false on the server to make this the only one).
      const runner = new JobRunner({ dir: archiveDir, logger: () => logger });
      // Adopt snapshots an interrupted run left pending. Only jobs whose heartbeat
      // has gone stale are taken, so work a live server is doing is left alone; the
      // sweep repeats because a freshly crashed process still looks alive for a while.
      const recover = () => {
        const recovered = runner.recoverPending();
        if (recovered > 0) {
          logger.info(`Re-queued ${recovered} snapshot(s) left pending by an interrupted run.`);
        }
      };
      recover();
      setInterval(recover, 60_000);
      logger.info(
        `Schedule worker started (polling every ${SCHEDULER_INTERVAL_MS / 1000}s, concurrency ${runner.concurrency}). Press Ctrl+C to stop.`,
      );
      startScheduler({ dir: archiveDir, runner, logger });
      break;
    }

    logger.error("Usage: webfrost schedule <add|list|remove|worker>");
    process.exit(1);
    break;
  }

  case "import": {
    // webfrost import [--format=<fmt>] <url-or-file>
    const formatFlagIdx = args.findIndex((a) => a.startsWith("--format="));
    const formatOverride = formatFlagIdx !== -1 ? args[formatFlagIdx]?.split("=")[1] : undefined;
    const positional = args.filter((_, i) => i !== formatFlagIdx);
    const source = positional[0];

    if (!source) {
      logger.error("Usage: webfrost import [--format=<fmt>] <url-or-file>");
      process.exit(1);
    }

    // Determine if source is a URL or a file path
    let content: string;
    let filename: string;
    let isSourceUrl = false;
    try {
      const parsed = new URL(source);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        isSourceUrl = true;
      }
    } catch {
      // not a URL
    }

    if (isSourceUrl) {
      // Same SSRF-safe fetcher as everywhere else (size cap, timeout, private ranges
      // refused unless WEBFROST_ALLOW_PRIVATE_URLS=true).
      let response: Response;
      try {
        response = await safeFetch(source);
      } catch (err) {
        logger.error(
          `Cannot fetch URL: ${source}: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
      if (!response.ok) {
        logger.error(`Cannot fetch URL: ${source}: HTTP ${response.status}`);
        process.exit(1);
      }
      content = await response.text();
      filename = new URL(source).pathname.split("/").pop() ?? source;
    } else {
      try {
        content = readFileSync(source, "utf8");
      } catch {
        logger.error(`Cannot read file: ${source}`);
        process.exit(1);
      }
      filename = source.split("/").pop() ?? source;
    }

    const VALID_FORMATS = ["rss", "opml", "netscape", "text"] as const;
    const format = VALID_FORMATS.includes(formatOverride as (typeof VALID_FORMATS)[number])
      ? (formatOverride as (typeof VALID_FORMATS)[number])
      : detectFormat(filename, content);
    const urls = parseUrls(content, format);
    // For RSS imports, deduplicate against already-archived URLs
    const deduplicate = format === "rss";

    const total = urls.length;
    let queued = 0;
    let skipped = 0;
    let failed = 0;

    const runner = new JobRunner({ dir: archiveDir, logger: () => logger });
    logger.info(
      `Detected format: ${format}. Found ${total} URL(s). Concurrency: ${runner.concurrency}.`,
    );

    const importStart = Date.now();
    const db = openDb(archiveDir);
    const snapshotIds: number[] = [];
    try {
      for (const url of urls) {
        if (deduplicate && isUrlArchived(db, url)) {
          skipped++;
          continue;
        }
        try {
          const snapshotId = runner.add(db, url);
          snapshotIds.push(snapshotId);
          queued++;
          logger.debug(
            `Enqueued ${queued + failed + skipped}/${total}: ${url} (snapshot ${snapshotId})`,
          );
        } catch {
          failed++;
          logger.warn(`Failed to enqueue ${queued + failed + skipped}/${total}: ${url}`);
        }
      }

      if (queued > 0) {
        logger.info(`Running ${queued} pipeline(s)...`);
        await runner.onIdle();
      }

      // Report what actually happened, not just what was queued.
      let done = 0;
      for (const id of snapshotIds) {
        const row = db
          .query<{ status: string }, [number]>("SELECT status FROM snapshots WHERE id = ?")
          .get(id);
        if (row?.status === "done") done++;
        else failed++;
      }

      const elapsed = ((Date.now() - importStart) / 1000).toFixed(1);
      logger.info(
        `Import complete: total=${total}, done=${done}, skipped=${skipped}, failed=${failed} (${elapsed}s)`,
      );
    } finally {
      db.close();
    }
    break;
  }

  case "tag": {
    const sub = args[0];

    if (sub === "--help" || sub === "-h") {
      printTagHelp();
      process.exit(0);
    }

    if (sub === "add") {
      // webfrost tag add <snapshot-id> <tag-name>
      const snapshotIdArg = args[1];
      const tagName = args[2];
      if (!snapshotIdArg || !tagName) {
        logger.error("Usage: webfrost tag add <snapshot-id> <tag-name>");
        process.exit(1);
      }
      const snapshotId = Number(snapshotIdArg);
      if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
        logger.error("Invalid snapshot id");
        process.exit(1);
      }
      const db = openDb(archiveDir);
      try {
        const snapshot = getSnapshot(db, snapshotId);
        if (!snapshot) {
          logger.error(`Snapshot ${snapshotId} not found.`);
          process.exit(1);
        }
        // Find existing tag by name or create it
        const existing = listTags(db).find((t) => t.name === tagName);
        const tag = existing ?? createTag(db, tagName);
        addTagToSnapshot(db, snapshotId, tag.id);
        logger.info(`Tag "${tag.name}" added to snapshot ${snapshotId}.`);
      } finally {
        db.close();
      }
      break;
    }

    if (sub === "list") {
      // webfrost tag list [<snapshot-id>]
      const snapshotIdArg = args[1];
      const db = openDb(archiveDir);
      try {
        if (snapshotIdArg !== undefined) {
          const snapshotId = Number(snapshotIdArg);
          if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
            logger.error("Invalid snapshot id");
            process.exit(1);
          }
          const snapshot = getSnapshot(db, snapshotId);
          if (!snapshot) {
            logger.error(`Snapshot ${snapshotId} not found.`);
            process.exit(1);
          }
          const tags = listSnapshotTags(db, snapshotId);
          if (tags.length === 0) {
            console.log("No tags on this snapshot.");
          }
          for (const t of tags) {
            const color = t.color ?? "-";
            console.log(`${t.id}\t${t.slug}\t${t.name}\t${color}`);
          }
        } else {
          const tags = listTags(db);
          if (tags.length === 0) {
            console.log("No tags.");
          }
          for (const t of tags) {
            const color = t.color ?? "-";
            console.log(`${t.id}\t${t.slug}\t${t.name}\t${color}`);
          }
        }
      } finally {
        db.close();
      }
      break;
    }

    if (sub === "create") {
      // webfrost tag create <name> [--color <hex>]
      const tagName = args[1];
      if (!tagName) {
        logger.error("Usage: webfrost tag create <name> [--color <hex>]");
        process.exit(1);
      }
      const colorIdx = args.indexOf("--color");
      const color = colorIdx !== -1 ? args[colorIdx + 1] : undefined;
      const db = openDb(archiveDir);
      try {
        const tag = createTag(db, tagName, color);
        console.log(`Tag created: ${tag.id}\t${tag.slug}\t${tag.name}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("UNIQUE") || msg.includes("unique")) {
          logger.error(`Tag "${tagName}" already exists.`);
          process.exit(1);
        }
        throw err;
      } finally {
        db.close();
      }
      break;
    }

    // webfrost tag remove <tag-id> -- removes tag from all snapshots and deletes it
    if (sub === "remove") {
      const tagIdArg = args[1];
      if (!tagIdArg) {
        logger.error("Usage: webfrost tag remove <tag-id>");
        process.exit(1);
      }
      const tagId = Number(tagIdArg);
      if (!Number.isInteger(tagId) || tagId <= 0) {
        logger.error("Invalid tag id");
        process.exit(1);
      }
      const db = openDb(archiveDir);
      try {
        const tag = getTag(db, tagId);
        if (!tag) {
          logger.error(`Tag ${tagId} not found.`);
          process.exit(1);
        }
        deleteTag(db, tagId);
        logger.info(`Tag "${tag.name}" removed.`);
      } finally {
        db.close();
      }
      break;
    }

    logger.error("Usage: webfrost tag <add|list|create|remove>");
    process.exit(1);
    break;
  }

  case "admin": {
    const sub = args[0];

    if (sub === "--help" || sub === "-h") {
      printAdminHelp();
      process.exit(0);
    }

    if (sub === "create") {
      // webfrost admin create --username <name> --password <pass>
      const usernameIdx = args.indexOf("--username");
      const passwordIdx = args.indexOf("--password");
      const usernameArg = usernameIdx !== -1 ? args[usernameIdx + 1] : undefined;
      const passwordArg = passwordIdx !== -1 ? args[passwordIdx + 1] : undefined;

      if (!usernameArg || !passwordArg) {
        logger.error("Usage: webfrost admin create --username <name> --password <pass>");
        process.exit(1);
      }
      if (passwordArg.length < 8) {
        logger.error("Password must be at least 8 characters.");
        process.exit(1);
      }

      const db = openDb(archiveDir);
      try {
        await createAdminUser(db, usernameArg, passwordArg);
        const { id, rawKey } = createApiKey(db, "default");
        logger.info(`Admin user "${usernameArg}" created.`);
        console.log("Default API key (save this — shown once):");
        console.log(`  ID:  ${id}`);
        console.log(`  Key: ${rawKey}`);
      } catch (err) {
        logger.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      } finally {
        db.close();
      }
      break;
    }

    if (sub === "key") {
      const keyCmd = args[1];

      if (keyCmd === "create") {
        // webfrost admin key create --name <label> [--expires <ISO date>]
        const nameIdx = args.indexOf("--name");
        const expiresIdx = args.indexOf("--expires");
        const nameArg = nameIdx !== -1 ? args[nameIdx + 1] : undefined;
        const expiresArg = expiresIdx !== -1 ? args[expiresIdx + 1] : undefined;

        if (!nameArg) {
          logger.error("Usage: webfrost admin key create --name <label> [--expires <ISO date>]");
          process.exit(1);
        }

        const db = openDb(archiveDir);
        try {
          const { id, rawKey } = createApiKey(db, nameArg, expiresArg);
          console.log("API key created (save this — shown once):");
          console.log(`  ID:  ${id}`);
          console.log(`  Key: ${rawKey}`);
        } finally {
          db.close();
        }
        break;
      }

      if (keyCmd === "list") {
        const db = openDb(archiveDir);
        try {
          const keys = listApiKeys(db);
          if (keys.length === 0) {
            console.log("No active API keys.");
          }
          for (const k of keys) {
            const expires = k.expiresAt ?? "never";
            const lastUsed = k.lastUsedAt ?? "never";
            console.log(`${k.id}\t${k.name}\texpires:${expires}\tlast_used:${lastUsed}`);
          }
        } finally {
          db.close();
        }
        break;
      }

      if (keyCmd === "revoke") {
        const keyId = args[2];
        if (!keyId) {
          logger.error("Usage: webfrost admin key revoke <id>");
          process.exit(1);
        }
        const db = openDb(archiveDir);
        try {
          const revoked = revokeApiKey(db, keyId);
          if (revoked) {
            logger.info(`API key ${keyId} revoked.`);
          } else {
            logger.error(`API key ${keyId} not found or already revoked.`);
            process.exit(1);
          }
        } finally {
          db.close();
        }
        break;
      }

      logger.error("Usage: webfrost admin key <create|list|revoke>");
      process.exit(1);
      break;
    }

    logger.error("Usage: webfrost admin <create|key>");
    process.exit(1);
    break;
  }

  case "search": {
    // webfrost search <query>
    const query = args.join(" ");
    if (!query.trim()) {
      logger.error("Usage: webfrost search <query>");
      process.exit(1);
    }
    const db = openDb(archiveDir);
    try {
      const results = searchSnapshots(db, query);
      if (results.items.length === 0) {
        console.log("No results.");
      }
      for (const r of results.items) {
        console.log(`${r.id}\t${r.url}`);
        if (r.snippet) {
          console.log(`  ${plainSnippet(r.snippet)}`);
        }
      }
    } finally {
      db.close();
    }
    break;
  }

  case "search:rebuild": {
    // webfrost search:rebuild — rebuild FTS index from existing data
    const db = openDb(archiveDir);
    try {
      rebuildIndex(db);
      logger.info("Search index rebuilt.");
    } finally {
      db.close();
    }
    break;
  }

  case "delete": {
    // webfrost delete <id>
    const idArg = args[0];
    if (!idArg) {
      logger.error("Usage: webfrost delete <id>");
      process.exit(1);
    }
    const id = Number(idArg);
    if (!Number.isInteger(id) || id <= 0) {
      logger.error("Invalid snapshot id");
      process.exit(1);
    }
    const db = openDb(archiveDir);
    try {
      const deleted = await deleteSnapshot(db, id, createStorageBackend(archiveDir));
      if (deleted) {
        logger.info(`Snapshot ${id} deleted.`);
      } else {
        logger.error(`Snapshot ${id} not found.`);
        process.exit(1);
      }
    } finally {
      db.close();
    }
    break;
  }

  default: {
    logger.error(`Unknown command: ${String(command)}`);
    logger.error(`Run "webfrost --help" for usage.`);
    process.exit(1);
  }
}
