/**
 * Headers for whatever stands in front of a WebFrost server and wants credentials of its own
 * before it lets a request through: an identity-aware proxy, an OAuth proxy, a load balancer's
 * sign-in. The browser gets past it with its sign-in page; a command line needs a header.
 *
 * Nothing here knows any particular product. Two generic sources, merged:
 *
 * - `WEBFROST_HEADERS`: the headers themselves, one `Name: value` per line (a service token).
 * - A headers command: a command the user chose, whose output is such lines. It is how a
 *   short-lived token is fetched from the proxy's own tool each time, in the way of kubectl's
 *   exec credential plugins and git's credential helpers. It comes from `--headers-command` of
 *   `webfrost login` (saved with the server's key, so later commands need nothing),
 *   or from `WEBFROST_HEADERS_COMMAND`.
 *
 * A server on a private network (a VPN, a tailnet) needs neither: it is simply reachable.
 *
 * The headers go to the server the command was pointed at and nowhere else (no request of the
 * CLI follows a redirect), and never to the terminal. WebFrost's own credentials, the API key in
 * `Authorization`, travel as before: the proxy's are in addition, not instead.
 */
import { spawn } from "node:child_process";
import type { Context } from "./cli";
import { savedServer } from "./credentials";
import { CliError } from "./errors";

/** Header names the CLI sets itself: the proxy's credentials may not replace or forge them. */
const RESERVED = new Set(["authorization", "content-type", "content-length", "host", "cookie"]);

/** How long a headers command may take: long enough for a helper that opens a sign-in page. */
const COMMAND_TIMEOUT_MS = 120_000;

/** Header lines (`Name: value`) as headers. A line of another shape is an error, not ignored. */
export function parseHeaders(raw: string | undefined, source: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of (raw ?? "").split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const colon = line.indexOf(":");
    const name = colon > 0 ? line.slice(0, colon).trim().toLowerCase() : "";
    const value = colon > 0 ? line.slice(colon + 1).trim() : "";
    // A header name is a token (RFC 9110); the value is the rest of the line, without controls.
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(name) || value === "" || /\p{Cc}/u.test(value)) {
      // The line may hold a secret: say where it is, not what it says.
      throw new CliError(
        `${source}: a line is not a header. Give one "Name: value" per line${name ? ` (the line starting with "${name.slice(0, 30)}")` : ""}.`,
      );
    }
    if (RESERVED.has(name)) {
      throw new CliError(
        `${source} cannot set ${name}: the command line sets it itself (Authorization carries WebFrost's API key). A proxy that takes its credentials there is not supported.`,
      );
    }
    headers[name] = value;
  }
  return headers;
}

/**
 * Run the headers command and read the headers it prints. It runs through the shell, as the user
 * wrote it, with WEBFROST_SERVER set to the server's address so one command can serve several
 * servers. Its error output goes to the terminal (a helper may ask to open a sign-in page there);
 * what it prints on standard output is read as headers and never shown.
 */
function runHeadersCommand(command: string, origin: string): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const shell = process.platform === "win32";
    const child = shell
      ? spawn(command, { shell: true, stdio: ["ignore", "pipe", "inherit"], env: env(origin) })
      : spawn("sh", ["-c", command], { stdio: ["ignore", "pipe", "inherit"], env: env(origin) });
    let out = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, COMMAND_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new CliError(`the headers command could not be run: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new CliError("the headers command did not finish within 2 minutes"));
        return;
      }
      if (code !== 0) {
        reject(
          new CliError(
            `the headers command failed (exit code ${code}); what it said is above. It is the command given to --headers-command or WEBFROST_HEADERS_COMMAND.`,
          ),
        );
        return;
      }
      try {
        const headers = parseHeaders(out, "the headers command's output");
        if (Object.keys(headers).length === 0) {
          throw new CliError(
            'the headers command printed nothing: it must print one "Name: value" per line',
          );
        }
        resolve(headers);
      } catch (err) {
        reject(err);
      }
    });
  });
}

function env(origin: string): NodeJS.ProcessEnv {
  return { ...process.env, WEBFROST_SERVER: origin };
}

const resolved = new Map<string, Record<string, string>>();

/** The proxy headers for a server, once {@link prepareServer} has run for it (none before). */
export function proxyHeaders(base: URL): Record<string, string> {
  return resolved.get(base.origin) ?? {};
}

/** The headers command that applies to a server: the flag, else the environment, else the saved one. */
export function headersCommandFor(base: URL, fromFlag?: string): string | undefined {
  return (
    fromFlag?.trim() ||
    process.env.WEBFROST_HEADERS_COMMAND?.trim() ||
    savedServer(base.origin)?.headersCommand?.trim() ||
    undefined
  );
}

/**
 * Work out, once per command, the headers a proxy in front of the server wants: the lines of
 * `WEBFROST_HEADERS`, then those the headers command prints (which win on the same name). Every
 * later request of the command sends them.
 */
export async function prepareServer(_ctx: Context, base: URL, commandFlag?: string): Promise<void> {
  if (resolved.has(base.origin)) return;
  const headers = parseHeaders(process.env.WEBFROST_HEADERS, "WEBFROST_HEADERS");
  const command = headersCommandFor(base, commandFlag);
  if (command) Object.assign(headers, await runHeadersCommand(command, base.origin));
  resolved.set(base.origin, headers);
}

/** What to tell someone whose request was answered with a redirect instead of the API. */
export function redirectAdvice(res: Response): string {
  let to = "";
  try {
    const host = new URL(res.headers.get("location") ?? "").host;
    // A host name only; what a server sends is never printed as it came.
    if (/^[a-z0-9.:-]{1,253}$/i.test(host)) to = ` to ${host}`;
  } catch {
    // No usable Location: the advice stands without it.
  }
  return `it answered with a redirect${to} (HTTP ${res.status}) instead of its API. If that is the server's new address, use it. If it is a sign-in page, something in front of the server wants credentials of its own: give them with --headers-command on webfrost login (a command that prints "Name: value" lines, such as your proxy's token tool) or in WEBFROST_HEADERS, or let requests to /api/ through the proxy (they carry WebFrost's own credentials).`;
}
