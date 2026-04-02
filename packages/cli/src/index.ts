// @webfrost/cli entry point
import { addUrl, listSnapshots, openDb } from "@webfrost/core";

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
    const db = openDb(archiveDir);
    await addUrl(db, url);
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
  default: {
    console.error(`Unknown command: ${String(command)}`);
    process.exit(1);
  }
}
