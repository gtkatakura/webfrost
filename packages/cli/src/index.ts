// @webfrost/cli entry point
import { readFileSync } from "node:fs";
import {
  addRssFeedSchedule,
  addSchedule,
  addTagToSnapshot,
  addUrl,
  createAdminUser,
  createApiKey,
  createSnapshot,
  createTag,
  deleteSnapshot,
  deleteTag,
  detectFormat,
  fetchRssFeedUrls,
  getDueSchedules,
  getSnapshot,
  getTag,
  isUrlArchived,
  listApiKeys,
  listSchedules,
  listSnapshotTags,
  listSnapshots,
  listTags,
  markScheduleRun,
  openDb,
  parseUrls,
  rebuildIndex,
  removeSchedule,
  revokeApiKey,
  runPipeline,
  searchSnapshots,
} from "@webfrost/core";

const archiveDir = process.env.WEBFROST_DIR ?? process.cwd();
const command = process.argv[2];
const args = process.argv.slice(3);

switch (command) {
  case "init": {
    openDb(archiveDir).close();
    console.log(`Archive initialized at ${archiveDir}`);
    break;
  }

  case "add": {
    const url = args[0];
    if (!url) {
      console.error("Usage: webfrost add <url>");
      process.exit(1);
    }
    let parsedAdd: URL;
    try {
      parsedAdd = new URL(url);
    } catch {
      console.error("Invalid URL");
      process.exit(1);
    }
    if (parsedAdd.protocol !== "http:" && parsedAdd.protocol !== "https:") {
      console.error("Only http/https URLs are supported");
      process.exit(1);
    }
    const db = openDb(archiveDir);
    await addUrl(db, url, archiveDir);
    db.close();
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
          console.error("Usage: webfrost schedule add --rss <feed-url> --cron <expr>");
        } else {
          console.error("Usage: webfrost schedule add <url> --cron <expr>");
        }
        process.exit(1);
      }

      let parsedSchedule: URL;
      try {
        parsedSchedule = new URL(urlArg);
      } catch {
        console.error("Invalid URL");
        process.exit(1);
      }
      if (parsedSchedule.protocol !== "http:" && parsedSchedule.protocol !== "https:") {
        console.error("Only http/https URLs are supported");
        process.exit(1);
      }

      const db = openDb(archiveDir);
      try {
        const id = isRss
          ? addRssFeedSchedule(db, urlArg, cronExpr)
          : addSchedule(db, urlArg, cronExpr);
        const label = isRss ? "RSS feed schedule" : "Schedule";
        console.log(`${label} ${id} created: ${urlArg} @ ${cronExpr}`);
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
        console.error("Usage: webfrost schedule remove <id>");
        process.exit(1);
      }
      const id = Number(idArg);
      if (!Number.isInteger(id) || id <= 0) {
        console.error("Invalid schedule id");
        process.exit(1);
      }
      const db = openDb(archiveDir);
      try {
        const removed = removeSchedule(db, id);
        if (removed) {
          console.log(`Schedule ${id} removed.`);
        } else {
          console.error(`Schedule ${id} not found.`);
          process.exit(1);
        }
      } finally {
        db.close();
      }
      break;
    }

    if (sub === "worker") {
      // Polling worker: checks due schedules every 30 seconds
      const intervalMs = 30_000;
      console.log(
        `Schedule worker started (polling every ${intervalMs / 1000}s). Press Ctrl+C to stop.`,
      );

      async function runDue(): Promise<void> {
        const db = openDb(archiveDir);
        let due: ReturnType<typeof getDueSchedules>;
        try {
          due = getDueSchedules(db);
        } finally {
          db.close();
        }

        for (const schedule of due) {
          if (schedule.kind === "rss_feed") {
            console.log(`[worker] Running RSS feed schedule ${schedule.id}: ${schedule.url}`);
            const db2 = openDb(archiveDir);
            try {
              const feedUrls = await fetchRssFeedUrls(schedule.url);
              let queued = 0;
              for (const url of feedUrls) {
                if (isUrlArchived(db2, url)) continue;
                const snapshotId = createSnapshot(db2, url);
                runPipeline(db2, snapshotId, url, archiveDir).catch((err: unknown) => {
                  console.error(`[worker] pipeline error for ${url}:`, err);
                });
                queued++;
              }
              markScheduleRun(db2, schedule.id, schedule.cron);
              console.log(
                `[worker] RSS feed schedule ${schedule.id} done (${feedUrls.length} items, ${queued} new)`,
              );
            } catch (err) {
              console.error(`[worker] RSS feed schedule ${schedule.id} failed:`, err);
            } finally {
              db2.close();
            }
          } else {
            console.log(`[worker] Running schedule ${schedule.id}: ${schedule.url}`);
            const db2 = openDb(archiveDir);
            try {
              const snapshotId = createSnapshot(db2, schedule.url);
              await runPipeline(db2, snapshotId, schedule.url, archiveDir);
              markScheduleRun(db2, schedule.id, schedule.cron);
              console.log(`[worker] Schedule ${schedule.id} done (snapshot ${snapshotId})`);
            } catch (err) {
              console.error(`[worker] Schedule ${schedule.id} failed:`, err);
            } finally {
              db2.close();
            }
          }
        }
      }

      await runDue();
      setInterval(runDue, intervalMs);
      break;
    }

    console.error("Usage: webfrost schedule <add|list|remove|worker>");
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
      console.error("Usage: webfrost import [--format=<fmt>] <url-or-file>");
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
      // Fetch from network (CLI context — user controls this machine)
      let response: Response;
      try {
        response = await fetch(source);
      } catch (err) {
        console.error(
          `Cannot fetch URL: ${source}: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
      if (!response.ok) {
        console.error(`Cannot fetch URL: ${source}: HTTP ${response.status}`);
        process.exit(1);
      }
      content = await response.text();
      filename = new URL(source).pathname.split("/").pop() ?? source;
    } else {
      try {
        content = readFileSync(source, "utf8");
      } catch {
        console.error(`Cannot read file: ${source}`);
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

    console.log(`Detected format: ${format}. Found ${total} URL(s).`);

    const db = openDb(archiveDir);
    for (const url of urls) {
      if (deduplicate && isUrlArchived(db, url)) {
        skipped++;
        continue;
      }
      try {
        const snapshotId = createSnapshot(db, url);
        // Fire-and-forget pipeline (don't await to keep progress flowing)
        runPipeline(db, snapshotId, url, archiveDir).catch((err: unknown) => {
          console.error(`[import] pipeline error for ${url}:`, err);
        });
        queued++;
        process.stdout.write(
          `\rProgress: ${queued + failed + skipped}/${total} (queued: ${queued}, skipped: ${skipped}, failed: ${failed})`,
        );
      } catch {
        failed++;
        process.stdout.write(
          `\rProgress: ${queued + failed + skipped}/${total} (queued: ${queued}, skipped: ${skipped}, failed: ${failed})`,
        );
      }
    }
    db.close();

    console.log(
      `\nImport complete: total=${total}, queued=${queued}, skipped=${skipped}, failed=${failed}`,
    );
    break;
  }

  case "tag": {
    const sub = args[0];

    if (sub === "add") {
      // webfrost tag add <snapshot-id> <tag-name>
      const snapshotIdArg = args[1];
      const tagName = args[2];
      if (!snapshotIdArg || !tagName) {
        console.error("Usage: webfrost tag add <snapshot-id> <tag-name>");
        process.exit(1);
      }
      const snapshotId = Number(snapshotIdArg);
      if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
        console.error("Invalid snapshot id");
        process.exit(1);
      }
      const db = openDb(archiveDir);
      try {
        const snapshot = getSnapshot(db, snapshotId);
        if (!snapshot) {
          console.error(`Snapshot ${snapshotId} not found.`);
          process.exit(1);
        }
        // Find existing tag by name or create it
        const existing = listTags(db).find((t) => t.name === tagName);
        const tag = existing ?? createTag(db, tagName);
        addTagToSnapshot(db, snapshotId, tag.id);
        console.log(`Tag "${tag.name}" added to snapshot ${snapshotId}.`);
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
            console.error("Invalid snapshot id");
            process.exit(1);
          }
          const snapshot = getSnapshot(db, snapshotId);
          if (!snapshot) {
            console.error(`Snapshot ${snapshotId} not found.`);
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
        console.error("Usage: webfrost tag create <name> [--color <hex>]");
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
          console.error(`Tag "${tagName}" already exists.`);
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
        console.error("Usage: webfrost tag remove <tag-id>");
        process.exit(1);
      }
      const tagId = Number(tagIdArg);
      if (!Number.isInteger(tagId) || tagId <= 0) {
        console.error("Invalid tag id");
        process.exit(1);
      }
      const db = openDb(archiveDir);
      try {
        const tag = getTag(db, tagId);
        if (!tag) {
          console.error(`Tag ${tagId} not found.`);
          process.exit(1);
        }
        deleteTag(db, tagId);
        console.log(`Tag "${tag.name}" removed.`);
      } finally {
        db.close();
      }
      break;
    }

    console.error("Usage: webfrost tag <add|list|create|remove>");
    process.exit(1);
    break;
  }

  case "admin": {
    const sub = args[0];

    if (sub === "create") {
      // webfrost admin create --username <name> --password <pass>
      const usernameIdx = args.indexOf("--username");
      const passwordIdx = args.indexOf("--password");
      const usernameArg = usernameIdx !== -1 ? args[usernameIdx + 1] : undefined;
      const passwordArg = passwordIdx !== -1 ? args[passwordIdx + 1] : undefined;

      if (!usernameArg || !passwordArg) {
        console.error("Usage: webfrost admin create --username <name> --password <pass>");
        process.exit(1);
      }

      const db = openDb(archiveDir);
      try {
        await createAdminUser(db, usernameArg, passwordArg);
        const { id, rawKey } = createApiKey(db, "default");
        console.log(`Admin user "${usernameArg}" created.`);
        console.log("Default API key (save this — shown once):");
        console.log(`  ID:  ${id}`);
        console.log(`  Key: ${rawKey}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
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
          console.error("Usage: webfrost admin key create --name <label> [--expires <ISO date>]");
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
          console.error("Usage: webfrost admin key revoke <id>");
          process.exit(1);
        }
        const db = openDb(archiveDir);
        try {
          const revoked = revokeApiKey(db, keyId);
          if (revoked) {
            console.log(`API key ${keyId} revoked.`);
          } else {
            console.error(`API key ${keyId} not found or already revoked.`);
            process.exit(1);
          }
        } finally {
          db.close();
        }
        break;
      }

      console.error("Usage: webfrost admin key <create|list|revoke>");
      process.exit(1);
      break;
    }

    console.error("Usage: webfrost admin <create|key>");
    process.exit(1);
    break;
  }

  case "search": {
    // webfrost search <query>
    const query = args.join(" ");
    if (!query.trim()) {
      console.error("Usage: webfrost search <query>");
      process.exit(1);
    }
    const db = openDb(archiveDir);
    try {
      const results = searchSnapshots(db, query);
      if (results.length === 0) {
        console.log("No results.");
      }
      for (const r of results) {
        console.log(`${r.id}\t${r.url}`);
        if (r.snippet) {
          console.log(`  ${r.snippet.replace(/<\/?mark>/g, "")}`);
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
      console.log("Search index rebuilt.");
    } finally {
      db.close();
    }
    break;
  }

  case "delete": {
    // webfrost delete <id>
    const idArg = args[0];
    if (!idArg) {
      console.error("Usage: webfrost delete <id>");
      process.exit(1);
    }
    const id = Number(idArg);
    if (!Number.isInteger(id) || id <= 0) {
      console.error("Invalid snapshot id");
      process.exit(1);
    }
    const db = openDb(archiveDir);
    try {
      const deleted = await deleteSnapshot(db, id, archiveDir);
      if (deleted) {
        console.log(`Snapshot ${id} deleted.`);
      } else {
        console.error(`Snapshot ${id} not found.`);
        process.exit(1);
      }
    } finally {
      db.close();
    }
    break;
  }

  default: {
    console.error(`Unknown command: ${String(command)}`);
    process.exit(1);
  }
}
