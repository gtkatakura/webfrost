/**
 * `webfrost rescue`, end to end: a WebFrost server in this process with failed snapshots of pages on a
 * local test site, and the CLI as a subprocess archiving them on its own archive and sending them back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabases, createApiKey, openDb, sql } from "@webfrost/core";

const CLI = join(import.meta.dir, "index.ts");
const ARTICLE = `<!doctype html><html><head><title>How quokkas live</title></head><body><article><h1>How quokkas live</h1>${"<p>The quokka is a small marsupial that lives on Rottnest Island and eats leaves and grasses.</p>".repeat(8)}</article></body></html>`;
const WALL = `<!doctype html><html><head><title>Just a moment...</title></head><body><p>${"Checking the browser before letting it in. ".repeat(10)}</p></body></html>`;

let serverDir: string;
let server: { port: number; stop: () => void };
let site: ReturnType<typeof Bun.serve>;
let apiKey: string;
let laptopDir: string;

function page(path: string): string {
  return `http://127.0.0.1:${site.port}${path}`;
}

async function runCli(args: string[]) {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    cwd: laptopDir,
    env: {
      ...process.env,
      WEBFROST_DIR: laptopDir,
      WEBFROST_API_KEY: apiKey,
      WEBFROST_ALLOW_PRIVATE_URLS: "true",
      WEBFROST_DOMAIN_DELAY_MS: "0",
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function onServer<T>(fn: (db: Awaited<ReturnType<typeof openDb>>) => Promise<T>) {
  const db = await openDb(serverDir);
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

/** A snapshot the server could not archive: blocked (403), as in Review failures. */
function seedFailure(url: string): Promise<number> {
  return onServer((db) =>
    db.insert(
      sql`INSERT INTO snapshots (url, status, failure_category, failure_detail)
          VALUES (${url}, 'failed', 'access_denied', 'HTTP 403')`,
    ),
  );
}

function state(id: number) {
  return onServer((db) =>
    db.get<{ status: string; trashed: number }>(
      sql`SELECT status, CASE WHEN trashed_at IS NULL THEN 0 ELSE 1 END AS trashed FROM snapshots WHERE id = ${id}`,
    ),
  );
}

beforeAll(async () => {
  site = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const { pathname } = new URL(req.url);
      const html = { "content-type": "text/html; charset=utf-8" };
      if (pathname.startsWith("/article")) return new Response(ARTICLE, { headers: html });
      if (pathname === "/wall") return new Response(WALL, { headers: html });
      if (pathname === "/gone") return new Response("not here", { status: 404 });
      return new Response("forbidden", { status: 403 });
    },
  });
  serverDir = mkdtempSync(join(tmpdir(), "webfrost-rescue-server-"));
  process.env.WEBFROST_DIR = serverDir;
  process.env.SESSION_SECRET ??= "rescue-test-secret-at-least-32-characters";
  apiKey = await onServer(async (db) => (await createApiKey(db, "rescue")).rawKey);
  const { app } = await import("@webfrost/server");
  const listening = app.listen({ port: 0, hostname: "127.0.0.1" });
  server = { port: listening.server?.port ?? 0, stop: () => void app.stop() };
});

afterAll(async () => {
  server.stop();
  site.stop(true);
  await closeDatabases();
  rmSync(serverDir, { recursive: true, force: true });
});

beforeEach(async () => {
  laptopDir = mkdtempSync(join(tmpdir(), "webfrost-rescue-laptop-"));
  await onServer(async (db) => {
    for (const table of ["archive_results", "snapshot_tags", "job_queue", "snapshots"]) {
      await db.run(sql`DELETE FROM ${sql.raw(table)}`);
    }
  });
});

afterEach(() => {
  rmSync(laptopDir, { recursive: true, force: true });
});

const from = () => ["--from", `http://127.0.0.1:${server.port}`];

describe("webfrost rescue", () => {
  test("sends only real pages, which replace their failure; walls, 404s and blocks stay as they are", async () => {
    const article = await seedFailure(page("/article"));
    const wall = await seedFailure(page("/wall"));
    const gone = await seedFailure(page("/gone"));
    const blocked = await seedFailure(page("/blocked"));

    const run = await runCli(["rescue", "blocked", ...from(), "--yes", "--json"]);
    expect(run.stderr).not.toContain("Error");
    expect(run.exitCode).toBe(0);
    const out = JSON.parse(run.stdout) as {
      summary: Record<string, number>;
      results: { id: number; outcome: string; remoteId?: number; reason?: string }[];
    };
    const byId = Object.fromEntries(out.results.map((r) => [r.id, r]));
    expect(byId[article]?.outcome).toBe("rescued");
    expect(byId[wall]?.outcome).toBe("wall");
    expect(byId[wall]?.reason).toContain("Just a moment");
    expect(byId[gone]?.outcome).toBe("gone");
    expect(byId[blocked]?.outcome).toBe("still-failing");
    expect(out.summary).toEqual({ rescued: 1, wall: 1, gone: 1, "still-failing": 1 });

    // On the server: the copy is done and searchable, its failure is in the trash, the rest untouched.
    const remoteId = byId[article]?.remoteId as number;
    expect(await state(remoteId)).toEqual({ status: "done", trashed: 0 });
    expect(await state(article)).toEqual({ status: "failed", trashed: 1 });
    for (const id of [wall, gone, blocked]) {
      expect(await state(id)).toEqual({ status: "failed", trashed: 0 });
    }
    const title = await onServer((db) =>
      db.get<{ content: string }>(
        sql`SELECT content FROM archive_results WHERE snapshot_id = ${remoteId} AND extractor = 'readability'`,
      ),
    );
    expect(JSON.parse(title?.content ?? "{}").title).toBe("How quokkas live");

    // Nothing is left in the scratch archive.
    const scratch = join(laptopDir, "rescue", "snapshots");
    expect(existsSync(scratch) ? readdirSync(scratch) : []).toEqual([]);

    // Again: the rescued page is no longer in the group, so it is neither archived nor sent twice.
    const again = await runCli(["rescue", "blocked", ...from(), "--yes", "--json"]);
    const second = JSON.parse(again.stdout) as { results: { id: number }[] };
    expect(second.results.map((r) => r.id).sort()).toEqual([wall, gone, blocked].sort());
    expect(
      await onServer(async (db) =>
        Number(
          (
            await db.get<{ n: number }>(
              sql`SELECT COUNT(*) AS n FROM snapshots WHERE status = 'done'`,
            )
          )?.n,
        ),
      ),
    ).toBe(1);
  }, 120_000);

  test("gives up on a domain after N failures in a row here", async () => {
    // Three blocked pages of the same domain; with --give-up-after 2 the third is not tried.
    const ids = [
      await seedFailure(page("/blocked/1")),
      await seedFailure(page("/blocked/2")),
      await seedFailure(page("/blocked/3")),
    ];
    const run = await runCli([
      "rescue",
      "blocked",
      ...from(),
      "--yes",
      "--json",
      "--give-up-after",
      "2",
    ]);
    const out = JSON.parse(run.stdout) as { summary: Record<string, number> };
    expect(out.summary).toEqual({ "still-failing": 2, "not-tried": 1 });
    for (const id of ids) expect(await state(id)).toEqual({ status: "failed", trashed: 0 });
  }, 60_000);

  test("--dry-run lists and changes nothing; without a terminal it needs --yes", async () => {
    const id = await seedFailure(page("/article/dry"));
    const dry = await runCli(["rescue", "blocked", ...from(), "--dry-run"]);
    expect(dry.exitCode).toBe(0);
    expect(dry.stdout).toBe("1\t127.0.0.1\n");
    expect(dry.stderr).toContain('1 failed snapshot across 1 domain in "Blocked by the site"');
    const noYes = await runCli(["rescue", "blocked", ...from()]);
    expect(noYes.exitCode).toBe(2);
    expect(noYes.stderr).toContain("--yes");
    expect(await state(id)).toEqual({ status: "failed", trashed: 0 });
    const bad = await runCli(["rescue", "nope", ...from()]);
    expect(bad.exitCode).toBe(2);
    expect(bad.stderr).toContain("Unknown group");
  }, 60_000);
});
