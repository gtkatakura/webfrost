import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The archive directory (database and snapshot files): WEBFROST_DIR, or ~/.webfrost.
 * The server and the CLI both use this, so `webfrost serve` and `webfrost add` see the
 * same archive unless told otherwise.
 */
export function webfrostDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.WEBFROST_DIR || join(homedir(), ".webfrost");
}
