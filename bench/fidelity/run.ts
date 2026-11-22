/**
 * Fidelity benchmark: does a change to archiving make any site look less like the real one?
 *
 *   bun bench/fidelity/run.ts [--base main] [--sites bench/fidelity/sites.txt] [--out dir]
 *
 * Archives every URL of the corpus with two versions of WebFrost at the same moment: the base (a git ref,
 * checked out into a temporary worktree) and this working tree. Then it renders the live page and both
 * archived copies (SingleFile, in the same 1280×4000 frame) and scores each copy against the live page
 * (1 = identical pixels, after scaling to 256 px wide). It fails when a site scores clearly worse with this
 * tree than with the base, so a fix for one site cannot quietly break another.
 *
 * Needs Chromium (WEBFROST_CHROMIUM_PATH, or Playwright's) and the network. Live pages move (animations,
 * rotating content), which affects both versions alike; the margin absorbs that noise.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { $ } from "bun";
import { chromium } from "playwright";

const argv = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
};
const repo = resolve(import.meta.dir, "../..");
const baseRef = opt("base", "main");
const sites = readFileSync(opt("sites", join(import.meta.dir, "sites.txt")), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));
const out = resolve(opt("out", mkdtempSync(join(tmpdir(), "webfrost-fidelity-"))));
const MARGIN = Number(opt("margin", "0.02"));
const FRAME = { width: 1280, height: 4000 };
mkdirSync(out, { recursive: true });

// ── Two servers: the base ref in a temporary worktree, and this tree ────────────────────────────────
const baseDir = mkdtempSync(join(tmpdir(), "webfrost-fidelity-base-"));
rmSync(baseDir, { recursive: true, force: true });
await $`git -C ${repo} worktree add --detach ${baseDir} ${baseRef}`.quiet();
await $`bun install --frozen-lockfile`.cwd(baseDir).quiet();

function startServer(dir: string, port: number) {
  const data = mkdtempSync(join(tmpdir(), "webfrost-fidelity-data-"));
  const proc = Bun.spawn(["bun", "run", "packages/server/src/index.ts"], {
    cwd: dir,
    env: {
      ...process.env,
      WEBFROST_DIR: data,
      AUTH_DISABLED: "true",
      PORT: String(port),
      WEBFROST_DOMAIN_DELAY_MS: "0",
      WEBFROST_CONCURRENCY: "3",
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  return { url: `http://127.0.0.1:${port}`, proc, data };
}

const servers = {
  base: startServer(baseDir, 3191),
  head: startServer(repo, 3192),
};

async function waitUp(url: string) {
  for (let i = 0; i < 60; i++) {
    if (
      await fetch(`${url}/health`)
        .then((r) => r.ok)
        .catch(() => false)
    )
      return;
    await Bun.sleep(500);
  }
  throw new Error(`${url} did not start`);
}

async function archiveAll(url: string): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  for (const site of sites) {
    const res = await fetch(`${url}/api/v1/snapshots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: site, colorScheme: "light" }),
    });
    ids.set(site, ((await res.json()) as { id: number }).id);
  }
  for (let i = 0; i < 240; i++) {
    const page = (await (await fetch(`${url}/api/v1/snapshots?status=pending&limit=1`)).json()) as {
      total: number;
    };
    if (page.total === 0) return ids;
    await Bun.sleep(2000);
  }
  throw new Error(`${url}: archives did not finish`);
}

try {
  await Promise.all([waitUp(servers.base.url), waitUp(servers.head.url)]);
  console.log(`Archiving ${sites.length} sites with ${baseRef} and with this tree...`);
  const [baseIds, headIds] = await Promise.all([
    archiveAll(servers.base.url),
    archiveAll(servers.head.url),
  ]);

  const browser = await chromium.launch(
    process.env.WEBFROST_CHROMIUM_PATH
      ? { executablePath: process.env.WEBFROST_CHROMIUM_PATH }
      : {},
  );
  const shoot = async (url: string, file: string) => {
    const page = await browser.newPage({ viewport: FRAME, colorScheme: "light" });
    try {
      await page.goto(url, { waitUntil: "load", timeout: 45_000 });
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(1_000);
      const png = await page.screenshot({ timeout: 45_000 });
      writeFileSync(file, png);
      return png.toString("base64");
    } catch {
      return null;
    } finally {
      await page.close();
    }
  };
  // Pixel similarity in a canvas: both images scaled to 256 px wide, 1 - mean absolute difference.
  const scorer = await browser.newPage();
  const similarity = (a: string, b: string) =>
    scorer.evaluate(
      async ([x, y]) => {
        const load = (src: string) =>
          new Promise<HTMLImageElement>((ok, fail) => {
            const img = new Image();
            img.onload = () => ok(img);
            img.onerror = fail;
            img.src = `data:image/png;base64,${src}`;
          });
        const [ia, ib] = await Promise.all([load(x as string), load(y as string)]);
        const w = 256;
        const h = Math.round((ia.height * w) / ia.width);
        const pixels = (img: HTMLImageElement) => {
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          const ctx = c.getContext("2d") as CanvasRenderingContext2D;
          ctx.drawImage(img, 0, 0, w, h);
          return ctx.getImageData(0, 0, w, h).data;
        };
        const pa = pixels(ia);
        const pb = pixels(ib);
        let diff = 0;
        for (let i = 0; i < pa.length; i += 4) {
          diff +=
            Math.abs(pa[i] - pb[i]) +
            Math.abs(pa[i + 1] - pb[i + 1]) +
            Math.abs(pa[i + 2] - pb[i + 2]);
        }
        return 1 - diff / ((pa.length / 4) * 3 * 255);
      },
      [a, b],
    );

  const rows: { site: string; base: number | null; head: number | null; verdict: string }[] = [];
  for (const [n, site] of sites.entries()) {
    const preview = (url: string, id: number | undefined) =>
      `${url}/api/v1/snapshots/${id}/archives/singlefile/preview`;
    const [live, base, head] = await Promise.all([
      shoot(site, join(out, `${n}-live.png`)),
      shoot(preview(servers.base.url, baseIds.get(site)), join(out, `${n}-base.png`)),
      shoot(preview(servers.head.url, headIds.get(site)), join(out, `${n}-head.png`)),
    ]);
    const sb = live && base ? await similarity(live, base) : null;
    const sh = live && head ? await similarity(live, head) : null;
    const verdict =
      sb === null || sh === null
        ? "skipped"
        : sh < sb - MARGIN
          ? "WORSE"
          : sh > sb + MARGIN
            ? "better"
            : "same";
    rows.push({ site, base: sb, head: sh, verdict });
    console.log(
      `${verdict.padEnd(7)} ${(sb ?? Number.NaN).toFixed(3)} → ${(sh ?? Number.NaN).toFixed(3)}  ${site}`,
    );
  }
  await browser.close();
  writeFileSync(join(out, "report.json"), JSON.stringify({ base: baseRef, rows }, null, 2));
  const worse = rows.filter((r) => r.verdict === "WORSE");
  console.log(
    `\n${rows.length} sites: ${rows.filter((r) => r.verdict === "better").length} better, ${worse.length} worse. Images and report.json in ${out}`,
  );
  if (worse.length > 0) process.exitCode = 1;
} finally {
  servers.base.proc.kill();
  servers.head.proc.kill();
  await $`git -C ${repo} worktree remove --force ${baseDir}`.quiet().nothrow();
}
