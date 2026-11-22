import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command, Context } from "../cli";
import { CliError } from "../errors";
import { embeddedUi } from "../ui-assets";

const MIN_SECRET_LENGTH = 32;

/**
 * The secret that signs login sessions. SESSION_SECRET wins; otherwise one is generated
 * on first run and kept in the data directory (mode 0600), so sessions survive restarts.
 * Returns where the secret came from.
 */
export function ensureSessionSecret(
  dir: string,
  env: NodeJS.ProcessEnv = process.env,
): "env" | "disabled" | "file" | "generated" {
  if (env.SESSION_SECRET) return "env";
  if (env.AUTH_DISABLED === "true") return "disabled";
  const file = join(dir, "session-secret");
  mkdirSync(dir, { recursive: true });
  if (existsSync(file)) {
    const stored = readFileSync(file, "utf8").trim();
    if (stored.length >= MIN_SECRET_LENGTH) {
      env.SESSION_SECRET = stored;
      return "file";
    }
  }
  const secret = randomBytes(32).toString("hex");
  writeFileSync(file, `${secret}\n`, { mode: 0o600 });
  // writeFileSync's mode only applies to a new file; tighten an existing one too.
  chmodSync(file, 0o600);
  env.SESSION_SECRET = secret;
  return "generated";
}

export const serveCommand: Command = {
  kind: "command",
  name: "serve",
  summary: "Run the server, web UI and scheduler in this process",
  description:
    "Start the HTTP API, the web UI and the schedule runner. It is the same server as the Docker image and reads the same environment variables.",
  options: {
    port: {
      type: "string",
      value: "port",
      description: "Port to listen on (default: PORT or 3000)",
    },
    host: {
      type: "string",
      value: "address",
      description:
        "Address to listen on (default: HOST, or 0.0.0.0; 127.0.0.1 with AUTH_DISABLED=true)",
    },
  },
  notes: `
Environment (see the configuration reference for the full list):
  PORT, HOST            where to listen (default :3000)
  WEBFROST_DIR          data directory (default ~/.webfrost)
  SESSION_SECRET        signs login sessions. When unset, serve generates one on first run
                        and stores it in <data dir>/session-secret (mode 0600), so keep
                        that directory private and back it up with the archive.
  AUTH_DISABLED=true    no login; the server then binds to 127.0.0.1 only
  WEBFROST_SETUP_TOKEN  required to complete first-run setup in the web UI
  WEBFROST_SCHEDULER=false   do not run schedules in this process
  OTEL_EXPORTER_OTLP_ENDPOINT  send traces and metrics to your OpenTelemetry collector
                        (off unless set; works for every webfrost command)

Ctrl+C (or SIGTERM) stops gracefully: running archives get up to
WEBFROST_SHUTDOWN_TIMEOUT_MS (default 20000) to finish.`,
  examples: ["webfrost serve", "webfrost serve --port 8080", "AUTH_DISABLED=true webfrost serve"],
  async run(ctx: Context) {
    const port = ctx.int("port", { min: 0, max: 65535 });
    if (port !== undefined) process.env.PORT = String(port);
    const host = ctx.string("host");
    if (host !== undefined) process.env.HOST = host;
    process.env.WEBFROST_DIR = ctx.dir;

    const secret = ensureSessionSecret(ctx.dir);
    if (secret === "generated") {
      ctx.logger.info(
        `Generated a session secret and stored it in ${join(ctx.dir, "session-secret")}`,
      );
    }

    // The server is loaded only now: it reads its configuration from the environment.
    const { startServer, embeddedAssets, StartupError } = await import("@webfrost/server");
    let server: ReturnType<typeof startServer>;
    try {
      server = startServer({
        uiAssets: embeddedUi ? embeddedAssets(embeddedUi) : undefined,
        installSignalHandlers: false,
      });
    } catch (err) {
      if (err instanceof StartupError) throw new CliError(err.message);
      throw err;
    }
    const shown =
      server.hostname === "0.0.0.0" || server.hostname === "::" ? "localhost" : server.hostname;
    ctx.logger.info(`WebFrost is running at http://${shown}:${server.port} (Ctrl+C to stop)`);

    return await new Promise<number>((resolve) => {
      ctx.onSignal((signal) => {
        ctx.logger.info(`${signal} received: shutting down...`);
        server.stop().then(
          () => resolve(0),
          () => resolve(1),
        );
      });
    });
  },
};
