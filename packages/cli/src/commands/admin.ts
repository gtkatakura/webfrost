import { createAdminUser, createApiKey, listApiKeys, revokeApiKey } from "@webfrost/core";
import type { Command, Context, Group } from "../cli";
import { CliError, UsageError } from "../errors";
import { firstLine, isInteractive, promptSecret, readStdin } from "../prompt";
import { withDb } from "./shared";

const MIN_PASSWORD_LENGTH = 8;

/** Parse `--expires` as an ISO 8601 date or date-time; returns it normalized to UTC. */
export function parseExpires(raw: string, path: string[]): string {
  const iso = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
  const date = new Date(raw.includes(" ") ? raw.replace(" ", "T") : raw);
  if (!iso.test(raw) || Number.isNaN(date.getTime())) {
    throw new UsageError(
      `Invalid --expires "${raw}": use an ISO 8601 date, for example 2027-01-31 or 2027-01-31T12:00:00Z.`,
      path,
    );
  }
  if (date.getTime() <= Date.now()) {
    throw new UsageError(`--expires "${raw}" is in the past.`, path);
  }
  return date.toISOString();
}

/**
 * Where the admin password comes from: --password-stdin, --password (which leaks into
 * shell history and `ps`, hence the warning), WEBFROST_PASSWORD, or an interactive prompt
 * (no echo, asked twice) on a terminal.
 */
async function readPassword(ctx: Context): Promise<string> {
  const path = ["admin", "create"];
  const flag = ctx.string("password");
  const fromStdin = ctx.bool("password-stdin");
  if (flag !== undefined && fromStdin) {
    throw new UsageError("Use either --password or --password-stdin, not both.", path);
  }
  let password: string | undefined;
  if (fromStdin) {
    password = firstLine(await readStdin());
  } else if (flag !== undefined) {
    ctx.logger.warn(
      "--password is visible in shell history and in the process list. Prefer --password-stdin, WEBFROST_PASSWORD, or the interactive prompt.",
    );
    password = flag;
  } else if (process.env.WEBFROST_PASSWORD) {
    password = process.env.WEBFROST_PASSWORD;
  } else if (isInteractive()) {
    password = await promptSecret("Password: ");
    if (password !== (await promptSecret("Repeat password: "))) {
      throw new CliError("The passwords do not match.");
    }
  } else {
    throw new UsageError(
      "No password given. Use --password-stdin, set WEBFROST_PASSWORD, or run on a terminal to be prompted.",
      path,
    );
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new UsageError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, path);
  }
  return password;
}

const adminCreate: Command = {
  kind: "command",
  name: "create",
  summary: "Create the admin user (and a default API key)",
  options: {
    username: { type: "string", value: "name", description: "Admin username" },
    "password-stdin": {
      type: "boolean",
      description: "Read the password from the first line of stdin",
    },
    password: {
      type: "string",
      value: "pass",
      description: "Password on the command line (leaks into shell history; prefer the others)",
    },
  },
  notes: `
Password sources, first match wins: --password-stdin, --password, the WEBFROST_PASSWORD
environment variable, then an interactive prompt (no echo) when run on a terminal.`,
  examples: [
    "webfrost admin create --username admin",
    "printf '%s' \"$PASSWORD\" | webfrost admin create --username admin --password-stdin",
  ],
  async run(ctx) {
    const username = ctx.string("username");
    if (!username) throw new UsageError("Missing --username <name>.", ["admin", "create"]);
    const password = await readPassword(ctx);
    await withDb(ctx, async (db) => {
      await createAdminUser(db, username, password);
      const { id, rawKey } = await createApiKey(db, "default");
      ctx.logger.info(`Admin user "${username}" created.`);
      console.log("Default API key (save this, it is shown once):");
      console.log(`  ID:  ${id}`);
      console.log(`  Key: ${rawKey}`);
    });
    return 0;
  },
};

const keyCreate: Command = {
  kind: "command",
  name: "create",
  summary: "Create an API key",
  options: {
    name: { type: "string", value: "label", description: "A label for the key" },
    expires: {
      type: "string",
      value: "date",
      description: "ISO 8601 expiry, for example 2027-01-31 (default: never)",
    },
  },
  examples: ["webfrost admin key create --name ci --expires 2027-01-31"],
  async run(ctx) {
    const path = ["admin", "key", "create"];
    const name = ctx.string("name");
    if (!name) throw new UsageError("Missing --name <label>.", path);
    const expiresRaw = ctx.string("expires");
    const expires = expiresRaw === undefined ? undefined : parseExpires(expiresRaw, path);
    await withDb(ctx, async (db) => {
      const { id, rawKey } = await createApiKey(db, name, expires);
      console.log("API key created (save this, it is shown once):");
      console.log(`  ID:  ${id}`);
      console.log(`  Key: ${rawKey}`);
    });
    return 0;
  },
};

const keyList: Command = {
  kind: "command",
  name: "list",
  summary: "List active API keys",
  async run(ctx) {
    await withDb(ctx, async (db) => {
      const keys = await listApiKeys(db);
      if (keys.length === 0) console.log("No active API keys.");
      for (const k of keys) {
        console.log(
          `${k.id}\t${k.name}\texpires:${k.expiresAt ?? "never"}\tlast_used:${k.lastUsedAt ?? "never"}`,
        );
      }
    });
    return 0;
  },
};

const keyRevoke: Command = {
  kind: "command",
  name: "revoke",
  summary: "Revoke an API key",
  args: [{ name: "id", description: "Key id (see `webfrost admin key list`)" }],
  async run(ctx) {
    const id = ctx.args[0] ?? "";
    await withDb(ctx, async (db) => {
      if (!(await revokeApiKey(db, id)))
        throw new CliError(`API key ${id} not found or already revoked.`);
      ctx.logger.info(`API key ${id} revoked.`);
    });
    return 0;
  },
};

const keyGroup: Group = {
  kind: "group",
  name: "key",
  summary: "Manage API keys (create, list, revoke)",
  children: [keyCreate, keyList, keyRevoke],
};

export const adminGroup: Group = {
  kind: "group",
  name: "admin",
  summary: "Create the admin user and manage API keys",
  children: [adminCreate, keyGroup],
};
