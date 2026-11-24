/**
 * `webfrost login <server>` and `webfrost logout <server>`: connect this machine to a WebFrost
 * server without creating and copying an API key by hand.
 *
 * It follows the OAuth 2.0 Device Authorization Grant (RFC 8628): the CLI starts a request and
 * shows a short code, a person signed in to the server's web UI approves it, and the CLI, which
 * has been polling, receives an API key the server created for it. The key is saved in a file
 * only this user can read and used by `push` and `rescue` from then on.
 */
import { spawn } from "node:child_process";
import { hostname } from "node:os";
import type { Command, Context } from "../cli";
import { credentialsPath, removeServer, saveServer, savedServer } from "../credentials";
import { CliError } from "../errors";
import { prepareServer, proxyHeaders, redirectAdvice } from "../proxy-headers";
import { printable, serverUrl } from "./push";
import { printJson } from "./shared";

interface Started {
  deviceCode: string;
  userCode: string;
  expiresIn: number;
  interval: number;
}

type Poll =
  | { status: "pending" | "denied" }
  | { status: "approved"; apiKey: string; key: { id: string; name: string } };

function apiUrl(base: URL, path: string): string {
  return `${base.href.replace(/\/+$/, "")}/api/v1${path}`;
}

/** A request without credentials that never follows a redirect, like every request to a server. */
async function post(base: URL, path: string, body: unknown): Promise<Response> {
  try {
    return await fetch(apiUrl(base, path), {
      method: "POST",
      headers: { ...proxyHeaders(base), "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "manual",
    });
  } catch (err) {
    throw new CliError(
      `cannot reach ${base.origin}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Why the server did not answer the API, in words that say what to do. */
function refusal(base: URL, res: Response): CliError {
  if (res.status >= 300 && res.status < 400) {
    return new CliError(`${base.origin} could not be asked: ${redirectAdvice(res)}`);
  }
  if (res.status === 404) {
    return new CliError(
      `${base.origin} does not offer webfrost login (an older WebFrost, or not a WebFrost server). Create an API key in its Settings > API keys and set WEBFROST_API_KEY instead.`,
    );
  }
  if (res.status === 429) {
    return new CliError(
      `${base.origin} has too many connection requests waiting (HTTP 429). Try again in a minute.`,
    );
  }
  return new CliError(`${base.origin} refused the request (HTTP ${res.status})`);
}

/** A user code as the protocol defines it: nothing else is ever shown, put in a URL or opened. */
const USER_CODE = /^[A-Z]{4}-[A-Z]{4}$/;

/**
 * The page where the request is approved. Built here from the address the person gave and the
 * validated code, never from a path the server sends: the URL is handed to the system's opener,
 * and a server (or someone between it and a plain-HTTP client) must not choose what gets opened.
 */
export function verificationUrl(base: URL, userCode: string): string {
  return `${base.href.replace(/\/+$/, "")}/#/connect?code=${userCode}`;
}

/**
 * Open a URL in the person's browser, when there is one to open. Best effort: on a machine with
 * no display (over SSH, in a container) nothing happens and the printed URL is what they use.
 */
function openBrowser(url: string): boolean {
  const { platform, env } = process;
  let command: string;
  let args: string[];
  if (platform === "darwin") {
    command = "open";
    args = [url];
  } else if (platform === "win32") {
    // Not `cmd /c start`: cmd.exe would interpret &, | and %VAR% in the URL as commands.
    command = "rundll32";
    args = ["url.dll,FileProtocolHandler", url];
  } else {
    if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
    command = "xdg-open";
    args = [url];
  }
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll until the request is answered or its time is up. */
async function waitForAnswer(base: URL, started: Started): Promise<Poll | { status: "expired" }> {
  const deadline = Date.now() + started.expiresIn * 1000;
  let interval = Math.max(1, started.interval) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    const res = await post(base, "/auth/device/token", { deviceCode: started.deviceCode });
    if (res.status === 404) return { status: "expired" };
    if (res.status === 429) {
      // Asked to slow down: wait what the server says, and keep the slower pace.
      const wait = Number(res.headers.get("retry-after"));
      interval = Math.min(30_000, interval + 2000);
      if (Number.isFinite(wait) && wait > 0) await sleep(Math.min(wait, 60) * 1000);
      continue;
    }
    if (!res.ok) throw refusal(base, res);
    const poll = (await res.json()) as Poll;
    if (poll.status !== "pending") return poll;
  }
  return { status: "expired" };
}

const LOGIN_PATH = ["login"];

export const loginCommand: Command = {
  kind: "command",
  name: "login",
  summary: "Connect this machine to a WebFrost server (no API key to copy)",
  description:
    "Ask the server for access and approve it in your browser: the command shows a short code and opens the server's web UI, where you (signed in) confirm the same code. The server then creates an API key for this machine, listed under Settings > API keys and revocable there. The key is saved in a file only you can read, and push and rescue use it from then on.",
  args: [
    { name: "server", description: "The server's base URL, e.g. https://archive.example.com" },
  ],
  options: {
    name: {
      type: "string",
      value: "text",
      description: 'The name the API key is listed under (default: "webfrost CLI on <hostname>")',
    },
    "headers-command": {
      type: "string",
      value: "command",
      description:
        'For a server behind a proxy with its own sign-in: a command that prints the headers the proxy wants, one "Name: value" per line. Saved with the key and run again by push, rescue and logout',
    },
    "no-browser": {
      type: "boolean",
      description: "Do not open a browser; print the address to open yourself",
    },
    insecure: {
      type: "boolean",
      description:
        "Allow a plain-HTTP server that is not this machine (the key travels unencrypted)",
    },
    json: {
      type: "boolean",
      description: "Print JSON at the end: { server, key: { id, name }, file } (never the key)",
    },
  },
  notes: `
The key is saved in $XDG_CONFIG_HOME/webfrost/credentials.json (~/.config/webfrost/credentials.json),
readable by you only. WEBFROST_API_KEY, when set, is used instead of a saved key.

A server behind a proxy with its own sign-in:
  --headers-command        a command that prints the proxy's headers ("Name: value" lines);
                           it sees WEBFROST_SERVER, is saved with the key and run again by
                           push, rescue and logout
  WEBFROST_HEADERS         the headers themselves, one per line (a service token)
  WEBFROST_HEADERS_COMMAND such a command for this run only
They are sent to that server only, next to the API key, and never printed or saved.

Exit codes:
  0  connected
  1  denied, expired, or the server could not be reached
  2  usage error`,
  examples: [
    "webfrost login https://archive.example.com",
    "webfrost login https://archive.example.com --no-browser   # over SSH: open the address elsewhere",
    'webfrost login http://localhost:3000 --name "laptop"',
  ],
  async run(ctx) {
    const base = serverUrl(ctx, ctx.args[0] ?? "", LOGIN_PATH);
    // Given now, or kept from an earlier login to this server (WEBFROST_HEADERS_COMMAND is for
    // one run and is not saved).
    const headersCommand =
      ctx.string("headers-command")?.trim() || savedServer(base.origin)?.headersCommand;
    await prepareServer(ctx, base, ctx.string("headers-command"));
    const say = (msg: string) => {
      if (!ctx.quiet) process.stderr.write(`${msg}\n`);
    };

    const name = (ctx.string("name") ?? `webfrost CLI on ${hostname()}`).slice(0, 100);
    const res = await post(base, "/auth/device", { name });
    if (!res.ok) throw refusal(base, res);
    const started = (await res.json()) as Started;
    if (
      typeof started.deviceCode !== "string" ||
      typeof started.userCode !== "string" ||
      !USER_CODE.test(started.userCode)
    ) {
      throw new CliError(`${base.origin} answered something that is not a connection request`);
    }

    const userCode = started.userCode;
    const url = verificationUrl(base, userCode);
    const opened = !ctx.bool("no-browser") && openBrowser(url);
    say(opened ? "Opening your browser at:" : "Open this address in a browser:");
    say(`\n  ${url}\n`);
    say("Sign in if asked, check that the page shows this code, and approve:");
    say(`\n  ${userCode}\n`);
    say(`Waiting for your approval (${Math.round(started.expiresIn / 60)} minutes at most)...`);

    const answer = await waitForAnswer(base, started);
    if (answer.status === "denied") {
      throw new CliError("The request was denied in the web UI. Nothing was saved.");
    }
    if (answer.status !== "approved") {
      throw new CliError(
        "The request expired before it was approved. Run the command again when you are ready.",
      );
    }

    saveServer(base.origin, {
      apiKey: answer.apiKey,
      keyId: answer.key.id,
      name: answer.key.name,
      savedAt: new Date().toISOString(),
      ...(headersCommand ? { headersCommand } : {}),
    });
    const keyName = printable(answer.key.name, 100);
    if (ctx.bool("json")) {
      printJson({
        server: base.origin,
        key: { id: answer.key.id, name: keyName },
        file: credentialsPath(),
      });
    } else {
      ctx.logger.info(
        `Connected to ${base.origin}. The API key "${keyName}" is saved in ${credentialsPath()}; revoke it any time with webfrost logout ${base.origin} or in the server's Settings > API keys.`,
      );
    }
    return 0;
  },
};

const LOGOUT_PATH = ["logout"];

export const logoutCommand: Command = {
  kind: "command",
  name: "logout",
  summary: "Disconnect from a server: revoke its saved API key and forget it",
  description:
    "Revoke, on the server, the API key webfrost login saved for it, and remove it from this machine. If the server cannot be reached the key is removed here only, and the command says so: revoke it in the server's Settings > API keys.",
  args: [{ name: "server", description: "The server's base URL, as given to webfrost login" }],
  options: {
    insecure: {
      type: "boolean",
      description: "Allow a plain-HTTP server that is not this machine",
    },
  },
  notes: `
Exit codes:
  0  the key was revoked and forgotten, or was only forgotten because the server no longer has it
  1  nothing was saved for this server, or the key could not be revoked on the server
  2  usage error`,
  examples: ["webfrost logout https://archive.example.com"],
  async run(ctx: Context) {
    const base = serverUrl(ctx, ctx.args[0] ?? "", LOGOUT_PATH);
    const saved = savedServer(base.origin);
    if (!saved) {
      throw new CliError(`No saved API key for ${base.origin}.`);
    }

    let revoked: "yes" | "gone" | "unknown" = "unknown";
    let why = "";
    try {
      await prepareServer(ctx, base);
      const res = await fetch(apiUrl(base, `/settings/keys/${encodeURIComponent(saved.keyId)}`), {
        method: "DELETE",
        headers: { ...proxyHeaders(base), authorization: `Bearer ${saved.apiKey}` },
        redirect: "manual",
      });
      // 401: the key no longer works there (revoked or expired); 404: it is not listed any more.
      if (res.status === 204) revoked = "yes";
      else if (res.status === 401 || res.status === 404) revoked = "gone";
      else why = `HTTP ${res.status}`;
    } catch (err) {
      why = err instanceof Error ? err.message : String(err);
    }

    removeServer(base.origin);
    if (revoked === "unknown") {
      throw new CliError(
        `The key was removed from this machine, but ${base.origin} could not revoke it (${why}): it still works there. Revoke "${printable(saved.name, 100)}" in its Settings > API keys.`,
      );
    }
    ctx.logger.info(
      revoked === "yes"
        ? `Disconnected from ${base.origin}: the API key was revoked and removed from this machine.`
        : `Disconnected from ${base.origin}: the server no longer had the key; it was removed from this machine.`,
    );
    return 0;
  },
};
