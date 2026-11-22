#!/usr/bin/env bun
/**
 * bench/vs-archivebox/run.ts
 *
 * WebFrost vs ArchiveBox benchmark harness.
 *
 * Prerequisites:
 *   docker compose -f bench/vs-archivebox/docker-compose.yml up -d --wait
 *
 * Usage:
 *   bun bench/vs-archivebox/run.ts [options]
 *
 * Options:
 *   --webfrost-url <url>          WebFrost base URL  (default: http://localhost:18081)
 *   --archivebox-url <url>        ArchiveBox base URL (default: http://localhost:18082)
 *   --fixture-url <url>           Fixture server URL for host-side health checks (default: http://localhost:18080)
 *   --fixture-internal-url <url>  Fixture URL used in archive requests sent to tools inside Docker
 *                                 (default: same as --fixture-url; set to http://fixtures in CI)
 *   --skip-archivebox             Skip ArchiveBox scenarios (WebFrost only)
 *   --skip-wget                   Skip wget comparison scenarios
 *   --skip-monolith               Skip monolith comparison scenarios
 *   --output <path>               JSON results file   (default: bench/vs-archivebox/results/latest.json)
 *   --compose-project <name>      Docker Compose project name (default: vs-archivebox)
 *
 * Metrics collected per scenario:
 *   wallMs       — wall-clock time from first request to last completion
 *   peakCpuPct   — peak CPU % sampled from `docker stats` during the run
 *   peakMemMb    — peak resident memory (MB) sampled from `docker stats`
 *   diskDeltaKb  — change in /data volume size (KB) before → after
 *   successCount — number of URLs archived successfully
 *   failureCount — number of URLs that failed or timed out
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Metrics {
  wallMs: number;
  peakCpuPct: number | null;
  peakMemMb: number | null;
  diskDeltaKb: number | null;
}

interface ScenarioResult {
  system: string;
  scenario: string;
  urlCount: number;
  urls: string[];
  metrics: Metrics;
  successCount: number;
  failureCount: number;
  timestamp: string;
}

interface BenchmarkRun {
  date: string;
  webfrostUrl: string;
  archiveboxUrl: string;
  fixtureUrl: string;
  composeProject: string;
  scenarios: ScenarioResult[];
}

interface DockerStat {
  cpuPct: number;
  memMb: number;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): {
  webfrostUrl: string;
  archiveboxUrl: string;
  fixtureUrl: string;
  fixtureInternalUrl: string;
  skipArchivebox: boolean;
  skipWget: boolean;
  skipMonolith: boolean;
  outputPath: string;
  composeProject: string;
} {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? (args[i + 1] as string) : fallback;
  };
  const fixtureUrl = get("--fixture-url", "http://localhost:18080");
  return {
    webfrostUrl: get("--webfrost-url", "http://localhost:18081"),
    archiveboxUrl: get("--archivebox-url", "http://localhost:18082"),
    fixtureUrl,
    // URL used inside Docker containers — must be reachable from within the bench_net bridge.
    // In CI, pass --fixture-internal-url http://fixtures (the Docker service name).
    // Defaults to fixtureUrl so local runs where both host and containers can reach localhost work.
    fixtureInternalUrl: get("--fixture-internal-url", fixtureUrl),
    skipArchivebox: args.includes("--skip-archivebox"),
    skipWget: args.includes("--skip-wget"),
    skipMonolith: args.includes("--skip-monolith"),
    outputPath: get("--output", resolve(import.meta.dir, "results/latest.json")),
    composeProject: get("--compose-project", "vs-archivebox"),
  };
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(url: string, label: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      if (res.ok) {
        console.log(`  ✓ ${label} healthy (${attempt} retries)`);
        return;
      }
    } catch {
      // not ready yet
    }
    attempt++;
    await sleep(2_000);
  }
  throw new Error(`${label} did not become healthy within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Docker stats sampling
// ---------------------------------------------------------------------------

/**
 * Parse Docker stats output for a single container.
 * `docker stats --no-stream --format json <name>` outputs one JSON line.
 */
async function sampleDockerStat(containerName: string): Promise<DockerStat | null> {
  try {
    const proc = Bun.spawn(
      ["docker", "stats", "--no-stream", "--format", "{{json .}}", containerName],
      { stdout: "pipe", stderr: "pipe" },
    );
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    const line = text.trim().split("\n")[0];
    if (!line) return null;
    const raw = JSON.parse(line) as Record<string, string>;
    // CPU field looks like "2.34%", MemUsage like "123MiB / 4GiB"
    const cpuStr = (raw.CPUPerc ?? raw.CPU ?? "0%").replace("%", "");
    const memStr = (raw.MemUsage ?? raw["MEM USAGE"] ?? "0MiB").split("/")[0]?.trim() ?? "0";
    const cpuPct = Number.parseFloat(cpuStr);
    const memMb = parseMemMb(memStr);
    return { cpuPct: Number.isNaN(cpuPct) ? 0 : cpuPct, memMb };
  } catch (err) {
    console.warn(`  [warn] docker stats failed for ${containerName}: ${err}`);
    return null;
  }
}

function parseMemMb(s: string): number {
  const n = Number.parseFloat(s);
  if (Number.isNaN(n)) return 0;
  const lower = s.toLowerCase();
  if (lower.includes("gib") || lower.includes("gb")) return n * 1024;
  if (lower.includes("kib") || lower.includes("kb")) return n / 1024;
  return n; // assume MiB / MB
}

/**
 * Poll docker stats in the background for the duration of a test.
 * Returns a stop function that resolves with peak values.
 */
function startStatSampler(
  containerName: string,
  intervalMs = 200,
): {
  stop: () => Promise<{ peakCpuPct: number | null; peakMemMb: number | null }>;
} {
  let running = true;
  let peakCpu = 0;
  let peakMem = 0;
  let hasSample = false;

  const loop = (async () => {
    while (running) {
      const stat = await sampleDockerStat(containerName);
      if (stat) {
        hasSample = true;
        if (stat.cpuPct > peakCpu) peakCpu = stat.cpuPct;
        if (stat.memMb > peakMem) peakMem = stat.memMb;
      }
      await sleep(intervalMs);
    }
  })();

  return {
    stop: async () => {
      running = false;
      await loop;
      return {
        peakCpuPct: hasSample ? Math.round(peakCpu * 10) / 10 : null,
        peakMemMb: hasSample ? Math.round(peakMem * 10) / 10 : null,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Disk usage
// ---------------------------------------------------------------------------

async function getDiskUsageKb(composeProject: string, service: string): Promise<number | null> {
  try {
    const containerName = `${composeProject}-${service}-1`;
    const proc = Bun.spawn(["docker", "exec", containerName, "du", "-sk", "/data"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    const kb = Number.parseInt(text.split("\t")[0] ?? "0", 10);
    return Number.isNaN(kb) ? null : kb;
  } catch (err) {
    console.warn(`  [warn] getDiskUsageKb failed for ${service}: ${err}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// WebFrost scenario runner
// ---------------------------------------------------------------------------

async function archiveWebFrost(
  baseUrl: string,
  url: string,
  pollIntervalMs = 500,
  timeoutMs = 60_000,
): Promise<{ success: boolean }> {
  // POST to create snapshot
  const res = await fetch(`${baseUrl}/api/v1/snapshots`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return { success: false };

  const data = (await res.json()) as { id: number };
  const id = data.id;

  // Poll until done or failed — poll immediately, then sleep between retries
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const poll = await fetch(`${baseUrl}/api/v1/snapshots/${id}`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!poll.ok) return { success: false };
      const snap = (await poll.json()) as { status: string };
      if (snap.status === "done") return { success: true };
      if (snap.status === "failed") return { success: false };
    } catch {
      // transient; keep polling
    }
    await sleep(pollIntervalMs);
  }
  return { success: false };
}

async function runWebFrostScenario(
  opts: ReturnType<typeof parseArgs>,
  urls: string[],
  scenarioName: string,
): Promise<ScenarioResult> {
  console.log(`  WebFrost — ${scenarioName} (${urls.length} URL${urls.length > 1 ? "s" : ""})`);

  const containerName = `${opts.composeProject}-webfrost-1`;
  const diskBefore = await getDiskUsageKb(opts.composeProject, "webfrost");
  const sampler = startStatSampler(containerName);

  const start = performance.now();

  // Submit all URLs concurrently, then wait for each to complete
  const results = await Promise.all(urls.map((url) => archiveWebFrost(opts.webfrostUrl, url)));

  const wallMs = Math.round(performance.now() - start);
  const { peakCpuPct, peakMemMb } = await sampler.stop();
  const diskAfter = await getDiskUsageKb(opts.composeProject, "webfrost");

  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.filter((r) => !r.success).length;

  console.log(
    `    → ${wallMs}ms wall | success=${successCount} fail=${failureCount} | cpu=${peakCpuPct ?? "n/a"}% mem=${peakMemMb ?? "n/a"}MB`,
  );

  return {
    system: "webfrost",
    scenario: scenarioName,
    urlCount: urls.length,
    urls,
    metrics: {
      wallMs,
      peakCpuPct,
      peakMemMb,
      diskDeltaKb: diskBefore !== null && diskAfter !== null ? diskAfter - diskBefore : null,
    },
    successCount,
    failureCount,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// ArchiveBox scenario runner
// ---------------------------------------------------------------------------

/**
 * Archive a single URL via `docker compose exec archivebox archivebox add <url>`.
 * Returns true if the process exits with code 0.
 */
async function archiveArchiveBox(
  composeFile: string,
  composeProject: string,
  urls: string[],
): Promise<{ success: boolean; stderr?: string }> {
  try {
    const proc = Bun.spawn(
      [
        "docker",
        "compose",
        "-f",
        composeFile,
        "-p",
        composeProject,
        "exec",
        "-T",
        "archivebox",
        "archivebox",
        "add",
        "--depth=0",
        ...urls,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [code, stderrText] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    return { success: code === 0, stderr: stderrText.trim() || undefined };
  } catch (err) {
    return { success: false, stderr: String(err) };
  }
}

const COMPOSE_FILE = resolve(import.meta.dir, "docker-compose.yml");

async function runArchiveBoxScenario(
  opts: ReturnType<typeof parseArgs>,
  urls: string[],
  scenarioName: string,
): Promise<ScenarioResult> {
  console.log(`  ArchiveBox — ${scenarioName} (${urls.length} URL${urls.length > 1 ? "s" : ""})`);

  const containerName = `${opts.composeProject}-archivebox-1`;
  const diskBefore = await getDiskUsageKb(opts.composeProject, "archivebox");
  const sampler = startStatSampler(containerName);

  const start = performance.now();

  // ArchiveBox CLI can accept multiple URLs in a single invocation — batch them
  // into chunks of 20 to avoid argument list limits.
  const CHUNK = 20;
  let successCount = 0;
  let failureCount = 0;
  for (let i = 0; i < urls.length; i += CHUNK) {
    const chunk = urls.slice(i, i + CHUNK);
    const r = await archiveArchiveBox(COMPOSE_FILE, opts.composeProject, chunk);
    if (r.success) {
      successCount += chunk.length;
    } else {
      failureCount += chunk.length;
    }
  }

  const wallMs = Math.round(performance.now() - start);
  const { peakCpuPct, peakMemMb } = await sampler.stop();
  const diskAfter = await getDiskUsageKb(opts.composeProject, "archivebox");

  console.log(
    `    → ${wallMs}ms wall | success=${successCount} fail=${failureCount} | cpu=${peakCpuPct ?? "n/a"}% mem=${peakMemMb ?? "n/a"}MB`,
  );

  return {
    system: "archivebox",
    scenario: scenarioName,
    urlCount: urls.length,
    urls,
    metrics: {
      wallMs,
      peakCpuPct,
      peakMemMb,
      diskDeltaKb: diskBefore !== null && diskAfter !== null ? diskAfter - diskBefore : null,
    },
    successCount,
    failureCount,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// wget scenario runner
// ---------------------------------------------------------------------------

/**
 * Measure how long wget takes to download a set of URLs.
 *
 * Each URL is fetched as `docker run --rm --network <net> alpine:3.20 wget ...`.
 * Sequential variant: URLs are fetched one at a time (wget's native model).
 * Parallel variant: up to WGET_CONCURRENCY URLs run simultaneously.
 * Disk delta is measured via a named Docker volume mounted at /output.
 * CPU/memory stats are null — ephemeral containers exit too fast to sample.
 */

const WGET_CONCURRENCY = 10;

async function wgetFetchUrl(network: string, volume: string, url: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(
      [
        "docker",
        "run",
        "--rm",
        "--network",
        network,
        "-v",
        `${volume}:/output`,
        "alpine:3.20",
        "sh",
        "-c",
        `wget --mirror --page-requisites --no-parent --convert-links -P /output -q "${url}"`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

async function measureWgetDisk(volume: string): Promise<number | null> {
  try {
    const du = Bun.spawn(
      [
        "docker",
        "run",
        "--rm",
        "-v",
        `${volume}:/output:ro`,
        "alpine:3.20",
        "du",
        "-sk",
        "/output",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const text = await new Response(du.stdout).text();
    await du.exited;
    const kb = Number.parseInt(text.split("\t")[0] ?? "0", 10);
    return Number.isNaN(kb) ? null : kb;
  } catch {
    return null;
  }
}

async function runWgetScenario(
  opts: ReturnType<typeof parseArgs>,
  urls: string[],
  scenarioName: string,
): Promise<ScenarioResult> {
  console.log(
    `  wget (sequential) — ${scenarioName} (${urls.length} URL${urls.length > 1 ? "s" : ""})`,
  );

  const network = `${opts.composeProject}_bench_net`;
  const volume = `wget_seq_bench_${Date.now()}`;

  await Bun.spawn(["docker", "volume", "create", volume], { stdout: "pipe", stderr: "pipe" })
    .exited;

  const start = performance.now();
  let successCount = 0;
  let failureCount = 0;

  for (const url of urls) {
    const ok = await wgetFetchUrl(network, volume, url);
    if (ok) successCount++;
    else failureCount++;
  }

  const wallMs = Math.round(performance.now() - start);
  const diskAfter = await measureWgetDisk(volume);

  await Bun.spawn(["docker", "volume", "rm", "-f", volume], { stdout: "pipe", stderr: "pipe" })
    .exited;

  console.log(
    `    → ${wallMs}ms wall | success=${successCount} fail=${failureCount} | cpu=n/a mem=n/a`,
  );

  return {
    system: "wget",
    scenario: scenarioName,
    urlCount: urls.length,
    urls,
    metrics: {
      wallMs,
      peakCpuPct: null,
      peakMemMb: null,
      diskDeltaKb: diskAfter !== null ? diskAfter : null,
    },
    successCount,
    failureCount,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Parallel wget variant: runs up to WGET_CONCURRENCY docker containers simultaneously.
 * This gives wget a fair chance to compete with WebFrost's concurrent submission model.
 */
async function runWgetParallelScenario(
  opts: ReturnType<typeof parseArgs>,
  urls: string[],
  scenarioName: string,
): Promise<ScenarioResult> {
  console.log(
    `  wget (parallel) — ${scenarioName} (${urls.length} URL${urls.length > 1 ? "s" : ""})`,
  );

  const network = `${opts.composeProject}_bench_net`;
  const volume = `wget_par_bench_${Date.now()}`;

  await Bun.spawn(["docker", "volume", "create", volume], { stdout: "pipe", stderr: "pipe" })
    .exited;

  const start = performance.now();
  let successCount = 0;
  let failureCount = 0;

  // Run in batches of WGET_CONCURRENCY to avoid overwhelming the CI runner
  for (let i = 0; i < urls.length; i += WGET_CONCURRENCY) {
    const batch = urls.slice(i, i + WGET_CONCURRENCY);
    const results = await Promise.all(batch.map((url) => wgetFetchUrl(network, volume, url)));
    successCount += results.filter(Boolean).length;
    failureCount += results.filter((r) => !r).length;
  }

  const wallMs = Math.round(performance.now() - start);
  const diskAfter = await measureWgetDisk(volume);

  await Bun.spawn(["docker", "volume", "rm", "-f", volume], { stdout: "pipe", stderr: "pipe" })
    .exited;

  console.log(
    `    → ${wallMs}ms wall | success=${successCount} fail=${failureCount} | cpu=n/a mem=n/a`,
  );

  return {
    system: "wget-parallel",
    scenario: scenarioName,
    urlCount: urls.length,
    urls,
    metrics: {
      wallMs,
      peakCpuPct: null,
      peakMemMb: null,
      diskDeltaKb: diskAfter !== null ? diskAfter : null,
    },
    successCount,
    failureCount,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Monolith scenario runner
// ---------------------------------------------------------------------------

/**
 * Measure how long monolith (y2z/monolith) takes to archive a set of URLs.
 *
 * Monolith bundles a full web page — HTML + assets — into a single self-contained
 * HTML file. Each URL runs as `docker run --rm --network <net> y2z/monolith <url> -o ...`.
 * Sequential variant: URLs archived one at a time (monolith's native model).
 * Parallel variant: up to MONOLITH_CONCURRENCY containers run simultaneously.
 * Like the wget runner, CPU/memory stats are null for ephemeral containers.
 */

const MONOLITH_CONCURRENCY = 10;

async function monolithArchiveUrl(
  network: string,
  volume: string,
  url: string,
  index: number,
): Promise<boolean> {
  try {
    const proc = Bun.spawn(
      [
        "docker",
        "run",
        "--rm",
        "--network",
        network,
        "-v",
        `${volume}:/output`,
        "y2z/monolith",
        url,
        "-o",
        `/output/page-${index}.html`,
        "-s", // silent
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

async function measureMonolithDisk(volume: string): Promise<number | null> {
  try {
    const du = Bun.spawn(
      [
        "docker",
        "run",
        "--rm",
        "-v",
        `${volume}:/output:ro`,
        "alpine:3.20",
        "du",
        "-sk",
        "/output",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const text = await new Response(du.stdout).text();
    await du.exited;
    const kb = Number.parseInt(text.split("\t")[0] ?? "0", 10);
    return Number.isNaN(kb) ? null : kb;
  } catch {
    return null;
  }
}

async function runMonolithScenario(
  opts: ReturnType<typeof parseArgs>,
  urls: string[],
  scenarioName: string,
): Promise<ScenarioResult> {
  console.log(
    `  monolith (sequential) — ${scenarioName} (${urls.length} URL${urls.length > 1 ? "s" : ""})`,
  );

  const network = `${opts.composeProject}_bench_net`;
  const volume = `monolith_seq_bench_${Date.now()}`;

  await Bun.spawn(["docker", "volume", "create", volume], { stdout: "pipe", stderr: "pipe" })
    .exited;

  const start = performance.now();
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < urls.length; i++) {
    const ok = await monolithArchiveUrl(network, volume, urls[i] as string, i);
    if (ok) successCount++;
    else failureCount++;
  }

  const wallMs = Math.round(performance.now() - start);
  const diskAfter = await measureMonolithDisk(volume);

  await Bun.spawn(["docker", "volume", "rm", "-f", volume], { stdout: "pipe", stderr: "pipe" })
    .exited;

  console.log(
    `    → ${wallMs}ms wall | success=${successCount} fail=${failureCount} | cpu=n/a mem=n/a`,
  );

  return {
    system: "monolith",
    scenario: scenarioName,
    urlCount: urls.length,
    urls,
    metrics: {
      wallMs,
      peakCpuPct: null,
      peakMemMb: null,
      diskDeltaKb: diskAfter !== null ? diskAfter : null,
    },
    successCount,
    failureCount,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Parallel monolith variant: runs up to MONOLITH_CONCURRENCY containers simultaneously.
 * Gives monolith a fair chance to compete with WebFrost's concurrent submission model.
 */
async function runMonolithParallelScenario(
  opts: ReturnType<typeof parseArgs>,
  urls: string[],
  scenarioName: string,
): Promise<ScenarioResult> {
  console.log(
    `  monolith (parallel) — ${scenarioName} (${urls.length} URL${urls.length > 1 ? "s" : ""})`,
  );

  const network = `${opts.composeProject}_bench_net`;
  const volume = `monolith_par_bench_${Date.now()}`;

  await Bun.spawn(["docker", "volume", "create", volume], { stdout: "pipe", stderr: "pipe" })
    .exited;

  const start = performance.now();
  let successCount = 0;
  let failureCount = 0;

  // Run in batches of MONOLITH_CONCURRENCY to avoid overwhelming the CI runner
  for (let i = 0; i < urls.length; i += MONOLITH_CONCURRENCY) {
    const batch = urls.slice(i, i + MONOLITH_CONCURRENCY);
    const results = await Promise.all(
      batch.map((url, j) => monolithArchiveUrl(network, volume, url, i + j)),
    );
    successCount += results.filter(Boolean).length;
    failureCount += results.filter((r) => !r).length;
  }

  const wallMs = Math.round(performance.now() - start);
  const diskAfter = await measureMonolithDisk(volume);

  await Bun.spawn(["docker", "volume", "rm", "-f", volume], { stdout: "pipe", stderr: "pipe" })
    .exited;

  console.log(
    `    → ${wallMs}ms wall | success=${successCount} fail=${failureCount} | cpu=n/a mem=n/a`,
  );

  return {
    system: "monolith-parallel",
    scenario: scenarioName,
    urlCount: urls.length,
    urls,
    metrics: {
      wallMs,
      peakCpuPct: null,
      peakMemMb: null,
      diskDeltaKb: diskAfter !== null ? diskAfter : null,
    },
    successCount,
    failureCount,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Scenario definitions
// ---------------------------------------------------------------------------

function buildScenarios(fixtureUrl: string): Array<{ name: string; urls: string[] }> {
  const pages = {
    small: `${fixtureUrl}/small.html`,
    medium: `${fixtureUrl}/medium.html`,
    large: `${fixtureUrl}/large.html`,
  };

  // Build batch arrays by cycling through the three page sizes
  const batch10 = Array.from({ length: 10 }, (_, i) => {
    const keys = ["small", "medium", "large"] as const;
    return pages[keys[i % 3] as keyof typeof pages];
  });
  const batch50 = Array.from({ length: 50 }, (_, i) => {
    const keys = ["small", "medium", "large"] as const;
    return pages[keys[i % 3] as keyof typeof pages];
  });
  const batch100 = Array.from({ length: 100 }, (_, i) => {
    const keys = ["small", "medium", "large"] as const;
    return pages[keys[i % 3] as keyof typeof pages];
  });

  return [
    { name: "single-small", urls: [pages.small] },
    { name: "single-medium", urls: [pages.medium] },
    { name: "single-large", urls: [pages.large] },
    { name: "batch-10", urls: batch10 },
    { name: "batch-50", urls: batch50 },
    { name: "batch-100", urls: batch100 },
  ];
}

// ---------------------------------------------------------------------------
// Markdown report generation
// ---------------------------------------------------------------------------

function fmtMs(n: number): string {
  if (n >= 60_000) return `${(n / 60_000).toFixed(1)} min`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)} s`;
  return `${n} ms`;
}

function fmtOpt(n: number | null, unit = ""): string {
  return n === null ? "—" : `${n}${unit}`;
}

function generateMarkdownSection(run: BenchmarkRun): string {
  const date = run.date.split("T")[0];

  // Collect the ordered list of systems present in this run
  const systemOrder = [
    "webfrost",
    "archivebox",
    "wget",
    "wget-parallel",
    "monolith",
    "monolith-parallel",
  ];
  const presentSystems = [...new Set(run.scenarios.map((s) => s.system))].sort((a, b) => {
    const ai = systemOrder.indexOf(a);
    const bi = systemOrder.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const systemLabel: Record<string, string> = {
    webfrost: "WebFrost (parallel)",
    archivebox: "ArchiveBox",
    wget: "wget (sequential)",
    "wget-parallel": "wget (parallel)",
    monolith: "monolith (sequential)",
    "monolith-parallel": "monolith (parallel)",
  };

  const competitors = presentSystems
    .filter((s) => s !== "webfrost")
    .map((s) => systemLabel[s] ?? s)
    .join(", ");

  const header = `
## WebFrost vs Competitors — Head-to-Head Comparison

**Date:** ${date}
**Fixture server:** ${run.fixtureUrl}
**WebFrost:** ${run.webfrostUrl}
**Systems compared:** ${presentSystems.map((s) => systemLabel[s] ?? s).join(", ")}

**Test pages:**
| Page | Size | Description |
|------|------|-------------|
| small.html | ~5 KB | Static blog post, minimal JS |
| medium.html | ~53 KB | News-style article, rich text |
| large.html | ~167 KB | Heavy page with inline CSS/JS |

**Scenarios:** single-URL (small, medium, large), batch 10, 50, 100 URLs.
**Metrics:** wall time, peak CPU %, peak memory MB, disk delta KB.
WebFrost and ArchiveBox stats sampled via \`docker stats\`; wget/monolith run as ephemeral containers (CPU/mem not available).

> **Concurrency note:** WebFrost submits all URLs concurrently (parallel). ArchiveBox batches in chunks of 20 (sequential chunks). wget and monolith are shown in two modes: sequential (one URL at a time, native model) and parallel (up to 10 simultaneous \`docker run\` containers). The parallel column for wget and monolith gives a fair apples-to-apples comparison against WebFrost's parallel submission model.

> **Validity note:** Scenarios where \`success=0\` (nothing was archived) are marked **INVALID** and excluded from speed comparisons — failure timing is not a meaningful benchmark.

`;

  const scenarios = [
    "single-small",
    "single-medium",
    "single-large",
    "batch-10",
    "batch-50",
    "batch-100",
  ];

  // Build per-system result maps
  const resultsBySystem = new Map(
    presentSystems.map((sys) => [
      sys,
      new Map(run.scenarios.filter((s) => s.system === sys).map((s) => [s.scenario, s])),
    ]),
  );

  // Wall time table — one column per system, plus a "WF vs fastest competitor" column
  let table = "### Wall Time\n\n";
  const sysHeaders = presentSystems.map((s) => systemLabel[s] ?? s).join(" wall | ");
  table += `| Scenario | URLs | ${sysHeaders} wall | WF vs best |\n`;
  table += `|----------|------|${"--------------|".repeat(presentSystems.length + 1)}\n`;

  for (const sc of scenarios) {
    const wfResult = resultsBySystem.get("webfrost")?.get(sc);
    const wfMs = wfResult?.metrics.wallMs ?? null;
    const urlCount =
      wfResult?.urlCount ??
      presentSystems
        .map((s) => resultsBySystem.get(s)?.get(sc)?.urlCount)
        .find((v) => v !== undefined) ??
      "?";

    // A scenario is invalid if the WebFrost result archived nothing
    const wfInvalid = wfResult !== undefined && wfResult.successCount === 0;

    const wallCols = presentSystems
      .map((s) => {
        const r = resultsBySystem.get(s)?.get(sc);
        if (!r) return "—";
        const invalid = r.successCount === 0;
        const label = fmtMs(r.metrics.wallMs);
        return invalid ? `~~${label}~~ ⚠️` : label;
      })
      .join(" | ");

    // Find fastest valid competitor to compare against WebFrost
    let vsLabel = "—";
    if (wfMs !== null && !wfInvalid) {
      const competitorMs = presentSystems
        .filter((s) => s !== "webfrost")
        .map((s) => {
          const r = resultsBySystem.get(s)?.get(sc);
          return r && r.successCount > 0 ? r.metrics.wallMs : null;
        })
        .filter((v): v is number => v !== null);
      if (competitorMs.length > 0) {
        const bestCompetitor = Math.min(...competitorMs);
        const ratio = bestCompetitor / wfMs;
        vsLabel = ratio > 1 ? `${ratio.toFixed(1)}× faster` : `${(1 / ratio).toFixed(1)}× slower`;
      }
    } else if (wfInvalid) {
      vsLabel = "**INVALID**";
    }

    table += `| ${sc} | ${urlCount} | ${wallCols} | ${vsLabel} |\n`;
  }

  table += "\n### Peak Resource Usage\n\n";
  table += "| Scenario | System | CPU % | Memory MB | Disk ΔKB |\n";
  table += "|----------|--------|-------|-----------|----------|\n";

  for (const sc of scenarios) {
    for (const sys of presentSystems) {
      const r = resultsBySystem.get(sys)?.get(sc);
      if (!r) continue;
      const label = systemLabel[sys] ?? sys;
      table += `| ${sc} | ${label} | ${fmtOpt(r.metrics.peakCpuPct, "%")} | ${fmtOpt(r.metrics.peakMemMb)} | ${fmtOpt(r.metrics.diskDeltaKb)} |\n`;
    }
  }

  table += "\n**Notes:**\n";
  table +=
    "- Wall time includes request submission + polling until all archives are marked `done`.\n";
  table += "- ArchiveBox scenarios use `archivebox add --depth=0` via `docker compose exec`.\n";
  table +=
    "- wget (sequential) runs one `docker run --rm alpine:3.20 wget` per URL; wget (parallel) runs up to 10 simultaneously.\n";
  table +=
    "- monolith (sequential) runs one `docker run --rm y2z/monolith` per URL; monolith (parallel) runs up to 10 simultaneously.\n";
  table +=
    "- CPU/memory are point-in-time samples at ~200 ms intervals; true peak may be higher.\n";
  table +=
    "- wget/monolith run as ephemeral containers — CPU/mem stats are not available (shown as —).\n";
  table +=
    "- Disk delta reflects growth in the output volume; ArchiveBox/wget may be higher due to asset mirroring.\n";

  return header + table;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs();

  const skipped = [
    opts.skipArchivebox ? "archivebox" : null,
    opts.skipWget ? "wget" : null,
    opts.skipMonolith ? "monolith" : null,
  ]
    .filter(Boolean)
    .join(", ");

  console.log("WebFrost vs competitors benchmark harness");
  console.log("==========================================");
  console.log(`WebFrost:   ${opts.webfrostUrl}`);
  console.log(`ArchiveBox: ${opts.archiveboxUrl}${opts.skipArchivebox ? " (skipped)" : ""}`);
  console.log(`wget:       docker run alpine:3.20${opts.skipWget ? " (skipped)" : ""}`);
  console.log(`monolith:   docker run y2z/monolith${opts.skipMonolith ? " (skipped)" : ""}`);
  console.log(`Fixtures:   ${opts.fixtureUrl} (host) / ${opts.fixtureInternalUrl} (internal)`);
  if (skipped) console.log(`Skipped:    ${skipped}`);
  console.log();

  // Health checks for long-running services
  console.log("Waiting for services...");
  await waitForHealth(`${opts.fixtureUrl}/small.html`, "fixtures");
  await waitForHealth(`${opts.webfrostUrl}/health`, "webfrost");
  if (!opts.skipArchivebox) {
    await waitForHealth(opts.archiveboxUrl, "archivebox");
  }
  console.log();

  // ---------------------------------------------------------------------------
  // Smoke test — verify each tool can archive at least one URL before the matrix
  // ---------------------------------------------------------------------------
  console.log("Smoke test: verifying each tool can archive one URL...");
  // Use the internal fixture URL — these URLs are fetched by tools running inside Docker containers.
  const smokeUrl = `${opts.fixtureInternalUrl}/small.html`;

  const wfSmoke = await archiveWebFrost(opts.webfrostUrl, smokeUrl);
  if (!wfSmoke.success) {
    console.error(
      `  ✗ WebFrost smoke test failed — cannot archive ${smokeUrl}. Aborting benchmark.`,
    );
    console.error(
      "    Check that the fixture server is reachable from within the WebFrost container.",
    );
    console.error(
      "    If running in CI, pass --fixture-internal-url http://<docker-service-name> (e.g. http://fixtures).",
    );
    process.exit(1);
  }
  console.log("  ✓ WebFrost smoke test passed");

  if (!opts.skipArchivebox) {
    const abSmoke = await archiveArchiveBox(COMPOSE_FILE, opts.composeProject, [smokeUrl]);
    if (!abSmoke.success) {
      console.warn(
        `  ✗ ArchiveBox smoke test failed — cannot archive ${smokeUrl}. Skipping ArchiveBox scenarios.`,
      );
      if (abSmoke.stderr) console.warn(`    stderr: ${abSmoke.stderr}`);
      opts.skipArchivebox = true;
    } else {
      console.log("  ✓ ArchiveBox smoke test passed");
    }
  }

  if (!opts.skipWget) {
    const network = `${opts.composeProject}_bench_net`;
    const wgetSmoke = Bun.spawn(
      [
        "docker",
        "run",
        "--rm",
        "--network",
        network,
        "alpine:3.20",
        "wget",
        "-q",
        "--spider",
        smokeUrl,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const wgetCode = await wgetSmoke.exited;
    if (wgetCode !== 0) {
      console.warn(
        "  ✗ wget smoke test failed — fixture URL unreachable from Docker network. Skipping wget scenarios.",
      );
      opts.skipWget = true;
    } else {
      console.log("  ✓ wget smoke test passed");
    }
  }

  if (!opts.skipMonolith) {
    const network = `${opts.composeProject}_bench_net`;
    const volume = `monolith_smoke_${Date.now()}`;
    await Bun.spawn(["docker", "volume", "create", volume], { stdout: "pipe", stderr: "pipe" })
      .exited;
    const ok = await monolithArchiveUrl(network, volume, smokeUrl, 0);
    await Bun.spawn(["docker", "volume", "rm", "-f", volume], { stdout: "pipe", stderr: "pipe" })
      .exited;
    if (!ok) {
      console.warn(
        `  ✗ monolith smoke test failed — cannot archive ${smokeUrl}. Skipping monolith scenarios.`,
      );
      opts.skipMonolith = true;
    } else {
      console.log("  ✓ monolith smoke test passed");
    }
  }

  console.log();

  const scenarios = buildScenarios(opts.fixtureInternalUrl);
  const results: ScenarioResult[] = [];

  for (const sc of scenarios) {
    console.log(`Scenario: ${sc.name}`);
    const wfResult = await runWebFrostScenario(opts, sc.urls, sc.name);
    results.push(wfResult);

    if (!opts.skipArchivebox) {
      const abResult = await runArchiveBoxScenario(opts, sc.urls, sc.name);
      results.push(abResult);
    }

    if (!opts.skipWget) {
      const wgetResult = await runWgetScenario(opts, sc.urls, sc.name);
      results.push(wgetResult);
      const wgetParResult = await runWgetParallelScenario(opts, sc.urls, sc.name);
      results.push(wgetParResult);
    }

    if (!opts.skipMonolith) {
      const monolithResult = await runMonolithScenario(opts, sc.urls, sc.name);
      results.push(monolithResult);
      const monolithParResult = await runMonolithParallelScenario(opts, sc.urls, sc.name);
      results.push(monolithParResult);
    }

    console.log();
  }

  const run: BenchmarkRun = {
    date: new Date().toISOString(),
    webfrostUrl: opts.webfrostUrl,
    archiveboxUrl: opts.archiveboxUrl,
    fixtureUrl: opts.fixtureUrl,
    composeProject: opts.composeProject,
    scenarios: results,
  };

  // Write JSON results
  mkdirSync(dirname(opts.outputPath), { recursive: true });
  writeFileSync(opts.outputPath, JSON.stringify(run, null, 2));
  console.log(`Results written to: ${opts.outputPath}`);

  // Print BENCHMARKS.md section to stdout for copy-paste
  const markdownSection = generateMarkdownSection(run);
  console.log("\n--- BENCHMARKS.md section ---\n");
  console.log(markdownSection);

  // Write to GitHub Actions Step Summary when running in CI
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(summaryPath, `${markdownSection}\n`);
    console.log("Results written to GITHUB_STEP_SUMMARY.");
  }
}

await main();
