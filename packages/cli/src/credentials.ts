/**
 * The API keys `webfrost login` saved, one per server, in a file only this user can read:
 * `$XDG_CONFIG_HOME/webfrost/credentials.json` (`~/.config/webfrost/credentials.json`).
 *
 * It lives with the user's configuration, not in the archive directory (WEBFROST_DIR): an
 * archive may sit on shared storage, in a volume or in a backup, and a key to another server
 * has no place there.
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface SavedServer {
  /** The API key itself. */
  apiKey: string;
  /** The key's id on the server, to revoke it at logout. */
  keyId: string;
  /** The name the key is listed under on the server. */
  name: string;
  savedAt: string;
  /**
   * A command of the user's that prints the headers a proxy in front of this server wants
   * (`webfrost login --headers-command`), run again by every command that talks to the server.
   */
  headersCommand?: string;
}

interface CredentialsFile {
  servers: Record<string, SavedServer>;
}

export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  const configHome = env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(configHome, "webfrost", "credentials.json");
}

/** True when the file can be read by someone other than its owner (never on Windows, which has no such bits). */
export function isReadableByOthers(path: string): boolean {
  if (process.platform === "win32") return false;
  try {
    return (statSync(path).mode & 0o077) !== 0;
  } catch {
    return false;
  }
}

function read(path: string): CredentialsFile {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { servers: {} };
  }
  try {
    const parsed = JSON.parse(text) as Partial<CredentialsFile> | null;
    const servers = parsed?.servers;
    if (typeof servers !== "object" || servers === null || Array.isArray(servers)) {
      return { servers: {} };
    }
    const valid: Record<string, SavedServer> = {};
    for (const [origin, entry] of Object.entries(servers)) {
      if (entry && typeof entry.apiKey === "string" && entry.apiKey !== "") valid[origin] = entry;
    }
    return { servers: valid };
  } catch {
    // A file that is not JSON holds no usable key; the next login rewrites it.
    return { servers: {} };
  }
}

/** Written to a private temporary file and renamed, so a crash never leaves half a file or a readable one. */
function write(path: string, file: CredentialsFile): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  // The mode above is masked by the umask and ignored when the file already existed.
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

/** What is saved for a server (by origin: scheme, host and port), if anything. */
export function savedServer(origin: string, path = credentialsPath()): SavedServer | undefined {
  return read(path).servers[origin];
}

export function saveServer(origin: string, entry: SavedServer, path = credentialsPath()): void {
  const file = read(path);
  file.servers[origin] = entry;
  write(path, file);
}

/** Forget a server. False when nothing was saved for it. */
export function removeServer(origin: string, path = credentialsPath()): boolean {
  const file = read(path);
  if (!(origin in file.servers)) return false;
  delete file.servers[origin];
  write(path, file);
  return true;
}
