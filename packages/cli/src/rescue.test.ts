/**
 * `webfrost rescue`, end to end: a WebFrost server in this process with failed snapshots of pages on a
 * local test site, and the CLI as a subprocess archiving them on its own archive and sending them back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabases, createApiKey, openDb, sql } from "@webfrost/core";

const CLI = join(import.meta.dir, "index.ts");
const ARTICLE = `<!doctype html><html><head><title>How quokkas live</title></head><body><article><h1>How quokkas live</h1>${"<p>The quokka is a small marsupial that lives on Rottnest Island and eats leaves and grasses.</p>".repeat(8)}</article></body></html>`;
/** The HTML is the article; a script turns it into a challenge, as a JS anti-bot check does. */
const SCRIPTED_WALL = ARTICLE.replace(
  "</body>",
  `<script>document.title = "Just a moment..."; document.body.innerHTML = "<p>Verify you are human</p>";</script></body>`,
);
const PDF = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);
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
      if (pathname === "/scripted-wall") return new Response(SCRIPTED_WALL, { headers: html });
      if (pathname === "/gone") return new Response("not here", { status: 404 });
      // A page behind a login: the site sends it to a sign-in page with plenty of text, answering 200.
      if (pathname === "/members-only") {
        return new Response(null, {
          status: 302,
          headers: { location: "/login?next=/members-only" },
        });
      }
      if (pathname === "/login") return new Response(ARTICLE, { headers: html });
      if (pathname === "/paper.pdf") {
        return new Response(PDF, { headers: { "content-type": "application/pdf" } });
      }
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

  test("every run leaves a log in logs/: one line per page as it is done, then the summary", async () => {
    const article = await seedFailure(page("/article"));
    const gone = await seedFailure(page("/gone"));
    const logs = join(laptopDir, "logs");

    // Looking is not a run: nothing is logged.
    await runCli(["rescue", "blocked", ...from(), "--dry-run"]);
    expect(existsSync(logs)).toBe(false);

    const run = await runCli(["rescue", "blocked", ...from(), "--yes", "--json"]);
    expect(run.exitCode).toBe(0);
    const out = JSON.parse(run.stdout) as {
      log: string;
      results: { id: number; remoteId?: number }[];
    };
    const files = readdirSync(logs);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^rescue-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.jsonl$/);
    expect(out.log).toBe(join(logs, files[0] ?? ""));
    expect(run.stderr).toContain(`Log of this run: ${out.log}`);

    const raw = readFileSync(out.log, "utf8");
    const lines = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.map((l) => l.event)).toEqual(["start", "page", "page", "end"]);
    expect(lines[0]).toMatchObject({
      command: "rescue",
      server: `http://127.0.0.1:${server.port}`,
      group: "blocked",
      total: 2,
      domains: 1,
    });
    const pages = Object.fromEntries(lines.slice(1, 3).map((l) => [l.id, l]));
    expect(pages[article]).toMatchObject({
      outcome: "rescued",
      url: page("/article"),
      of: 2,
      remoteId: out.results.find((r) => r.id === article)?.remoteId,
    });
    expect(pages[gone]).toMatchObject({ outcome: "gone", url: page("/gone") });
    expect(String(pages[gone]?.reason)).toContain("404");
    expect(lines[3]).toMatchObject({
      summary: { rescued: 1, gone: 1 },
      notReached: 0,
      stopped: false,
    });
    // What it was done with is not in it.
    expect(raw).not.toContain(apiKey);

    // The next run gets a file of its own; --no-log writes none.
    await seedFailure(page("/blocked"));
    await runCli(["rescue", "blocked", ...from(), "--yes", "--no-log"]);
    expect(readdirSync(logs)).toHaveLength(1);
    const again = await runCli(["rescue", "blocked", ...from(), "--yes"]);
    expect(again.stderr).toContain("Every page and why, in ");
    expect(readdirSync(logs)).toHaveLength(2);
  }, 120_000);

  test("a challenge that only appears once scripts run is caught in the browser's DOM, not sent", async () => {
    const id = await seedFailure(page("/scripted-wall"));
    const run = await runCli(["rescue", "blocked", ...from(), "--yes", "--json"]);
    const out = JSON.parse(run.stdout) as { results: { outcome: string; reason?: string }[] };
    expect(out.results[0]?.outcome).toBe("wall");
    expect(out.results[0]?.reason).toContain("in the browser");
    expect(await state(id)).toEqual({ status: "failed", trashed: 0 });
  }, 60_000);

  test("a redirect to a login page is not sent; a PDF (no text, no DOM to check) is", async () => {
    const login = await seedFailure(page("/members-only"));
    const pdf = await seedFailure(page("/paper.pdf"));
    const run = await runCli(["rescue", "blocked", ...from(), "--yes", "--json"]);
    const out = JSON.parse(run.stdout) as {
      results: { id: number; outcome: string; reason?: string }[];
    };
    const byId = Object.fromEntries(out.results.map((r) => [r.id, r]));
    expect(byId[login]?.outcome).toBe("wall");
    expect(byId[login]?.reason).toContain("login");
    expect(byId[pdf]?.outcome).toBe("rescued");
    expect(await state(login)).toEqual({ status: "failed", trashed: 0 });
    expect(await state(pdf)).toEqual({ status: "failed", trashed: 1 });
  }, 60_000);

  test("several failures of one URL: archived and sent once, the others go to the trash", async () => {
    const a = await seedFailure(page("/article/twice"));
    const b = await seedFailure(page("/article/twice"));
    const run = await runCli(["rescue", "blocked", ...from(), "--yes", "--json"]);
    const out = JSON.parse(run.stdout) as {
      results: { id: number; outcome: string; remoteId?: number }[];
    };
    expect(out.results.map((r) => r.outcome)).toEqual(["rescued", "rescued"]);
    expect(new Set(out.results.map((r) => r.remoteId)).size).toBe(1);
    expect(await state(a)).toEqual({ status: "failed", trashed: 1 });
    expect(await state(b)).toEqual({ status: "failed", trashed: 1 });
    const copies = await onServer(async (db) =>
      Number(
        (
          await db.get<{ n: number }>(
            sql`SELECT COUNT(*) AS n FROM snapshots WHERE status = 'done'`,
          )
        )?.n,
      ),
    );
    expect(copies).toBe(1);
  }, 60_000);

  test("the scratch archive stays SQLite and files under rescue/, whatever DATABASE_URL says", async () => {
    const id = await seedFailure(page("/article/isolated"));
    const proc = Bun.spawn(
      ["bun", "run", CLI, "rescue", "blocked", ...from(), "--yes", "--json", "--keep"],
      {
        cwd: laptopDir,
        env: {
          ...process.env,
          WEBFROST_DIR: laptopDir,
          WEBFROST_API_KEY: apiKey,
          WEBFROST_ALLOW_PRIVATE_URLS: "true",
          WEBFROST_DOMAIN_DELAY_MS: "0",
          // An archive this machine must not touch: a rescue writing there would create the file.
          DATABASE_URL: `sqlite://${join(laptopDir, "not-the-scratch.db")}`,
          WEBFROST_STORAGE_BACKEND: "s3",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    expect(code).toBe(0);
    expect((JSON.parse(stdout) as { results: { outcome: string }[] }).results[0]?.outcome).toBe(
      "rescued",
    );
    expect(existsSync(join(laptopDir, "not-the-scratch.db"))).toBe(false);
    expect(existsSync(join(laptopDir, "rescue", "archive.db"))).toBe(true);
    expect(await state(id)).toEqual({ status: "failed", trashed: 1 });
  }, 60_000);

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
