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
 *   --webfrost-url <url>      WebFrost base URL  (default: http://localhost:18081)
 *   --archivebox-url <url>    ArchiveBox base URL (default: http://localhost:18082)
 *   --fixture-url <url>       Fixture server URL  (default: http://localhost:18080)
 *   --skip-archivebox         Skip ArchiveBox scenarios (WebFrost only)
 *   --output <path>           JSON results file   (default: bench/vs-archivebox/results/latest.json)
 *   --compose-project <name>  Docker Compose project name (default: vs-archivebox)
 *
 * Metrics collected per scenario:
 *   wallMs       — wall-clock time from first request to last completion
 *   peakCpuPct   — peak CPU % sampled from `docker stats` during the run
 *   peakMemMb    — peak resident memory (MB) sampled from `docker stats`
 *   diskDeltaKb  — change in /data volume size (KB) before → after
 *   successCount — number of URLs archived successfully
 *   failureCount — number of URLs that failed or timed out
 */

import { mkdirSync, writeFileSync } from "node:fs";
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
  system: "webfrost" | "archivebox";
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
  skipArchivebox: boolean;
  outputPath: string;
  composeProject: string;
} {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? (args[i + 1] as string) : fallback;
  };
  return {
    webfrostUrl: get("--webfrost-url", "http://localhost:18081"),
    archiveboxUrl: get("--archivebox-url", "http://localhost:18082"),
    fixtureUrl: get("--fixture-url", "http://localhost:18080"),
    skipArchivebox: args.includes("--skip-archivebox"),
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
  } catch {
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
  intervalMs = 800,
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
  } catch {
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
  const res = await fetch(`${baseUrl}/api/snapshots`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return { success: false };

  const data = (await res.json()) as { id: number };
  const id = data.id;

  // Poll until done or failed
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    try {
      const poll = await fetch(`${baseUrl}/api/snapshots/${id}`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!poll.ok) return { success: false };
      const snap = (await poll.json()) as { status: string };
      if (snap.status === "done") return { success: true };
      if (snap.status === "failed") return { success: false };
    } catch {
      // transient; keep polling
    }
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
): Promise<{ success: boolean }> {
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
    const code = await proc.exited;
    return { success: code === 0 };
  } catch {
    return { success: false };
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

  const header = `
## WebFrost vs ArchiveBox — Head-to-Head Comparison

**Date:** ${date}
**Fixture server:** ${run.fixtureUrl}
**WebFrost:** ${run.webfrostUrl}
**ArchiveBox:** ${run.archiveboxUrl}

**Test pages:**
| Page | Size | Description |
|------|------|-------------|
| small.html | ~5 KB | Static blog post, minimal JS |
| medium.html | ~53 KB | News-style article, rich text |
| large.html | ~167 KB | Heavy page with inline CSS/JS |

**Scenarios:** single-URL (small, medium, large), batch 10, 50, 100 URLs.
**Metrics:** wall time, peak CPU %, peak memory MB, disk delta KB.
All metrics sampled via \`docker stats\`; disk via \`du -sk /data\` before/after.

`;

  const scenarios = [
    "single-small",
    "single-medium",
    "single-large",
    "batch-10",
    "batch-50",
    "batch-100",
  ];

  const wfResults = new Map(
    run.scenarios.filter((s) => s.system === "webfrost").map((s) => [s.scenario, s]),
  );
  const abResults = new Map(
    run.scenarios.filter((s) => s.system === "archivebox").map((s) => [s.scenario, s]),
  );

  let table = "### Wall Time\n\n";
  table += "| Scenario | URLs | WebFrost wall | ArchiveBox wall | WF faster? |\n";
  table += "|----------|------|--------------|-----------------|------------|\n";

  for (const sc of scenarios) {
    const wf = wfResults.get(sc);
    const ab = abResults.get(sc);
    const wfMs = wf?.metrics.wallMs ?? null;
    const abMs = ab?.metrics.wallMs ?? null;
    const urlCount = wf?.urlCount ?? ab?.urlCount ?? "?";
    let faster = "—";
    if (wfMs !== null && abMs !== null) {
      const ratio = abMs / wfMs;
      faster = ratio > 1 ? `${ratio.toFixed(1)}× faster` : `${(1 / ratio).toFixed(1)}× slower`;
    }
    table += `| ${sc} | ${urlCount} | ${wfMs !== null ? fmtMs(wfMs) : "—"} | ${abMs !== null ? fmtMs(abMs) : "—"} | ${faster} |\n`;
  }

  table += "\n### Peak Resource Usage\n\n";
  table += "| Scenario | System | CPU % | Memory MB | Disk ΔKB |\n";
  table += "|----------|--------|-------|-----------|----------|\n";

  for (const sc of scenarios) {
    for (const [label, map] of [
      ["WebFrost", wfResults],
      ["ArchiveBox", abResults],
    ] as const) {
      const r = map.get(sc);
      if (!r) continue;
      table += `| ${sc} | ${label} | ${fmtOpt(r.metrics.peakCpuPct, "%")} | ${fmtOpt(r.metrics.peakMemMb)} | ${fmtOpt(r.metrics.diskDeltaKb)} |\n`;
    }
  }

  table += "\n**Notes:**\n";
  table +=
    "- Wall time includes request submission + polling until all archives are marked `done`.\n";
  table += "- ArchiveBox scenarios use `archivebox add --depth=0` via `docker compose exec`.\n";
  table +=
    "- CPU/memory are point-in-time samples at ~800 ms intervals; true peak may be higher.\n";
  table +=
    "- Disk delta reflects growth in the `/data` volume; ArchiveBox may be higher due to wget mirrors.\n";

  return header + table;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs();

  console.log("WebFrost vs ArchiveBox benchmark harness");
  console.log("=========================================");
  console.log(`WebFrost:  ${opts.webfrostUrl}`);
  console.log(`ArchiveBox: ${opts.archiveboxUrl}${opts.skipArchivebox ? " (skipped)" : ""}`);
  console.log(`Fixtures:  ${opts.fixtureUrl}`);
  console.log();

  // Health checks
  console.log("Waiting for services...");
  await waitForHealth(`${opts.fixtureUrl}/small.html`, "fixtures");
  await waitForHealth(`${opts.webfrostUrl}/health`, "webfrost");
  if (!opts.skipArchivebox) {
    await waitForHealth(opts.archiveboxUrl, "archivebox");
  }
  console.log();

  const scenarios = buildScenarios(opts.fixtureUrl);
  const results: ScenarioResult[] = [];

  for (const sc of scenarios) {
    console.log(`Scenario: ${sc.name}`);
    const wfResult = await runWebFrostScenario(opts, sc.urls, sc.name);
    results.push(wfResult);

    if (!opts.skipArchivebox) {
      const abResult = await runArchiveBoxScenario(opts, sc.urls, sc.name);
      results.push(abResult);
    }

    console.log();
  }

  const run: BenchmarkRun = {
    date: new Date().toISOString(),
    webfrostUrl: opts.webfrostUrl,
    archiveboxUrl: opts.archiveboxUrl,
    fixtureUrl: opts.fixtureUrl,
    scenarios: results,
  };

  // Write JSON results
  mkdirSync(dirname(opts.outputPath), { recursive: true });
  writeFileSync(opts.outputPath, JSON.stringify(run, null, 2));
  console.log(`Results written to: ${opts.outputPath}`);

  // Print BENCHMARKS.md section to stdout for copy-paste
  console.log("\n--- BENCHMARKS.md section ---\n");
  console.log(generateMarkdownSection(run));
}

await main();
