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
 *   --skip-wget               Skip wget comparison scenarios
 *   --skip-monolith           Skip monolith comparison scenarios
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
// wget scenario runner
// ---------------------------------------------------------------------------

/**
 * Measure how long wget takes to download a set of URLs.
 *
 * Each URL is fetched as `docker run --rm --network <net> alpine:3.20 wget ...`.
 * We run URLs sequentially (wget is single-threaded by design).
 * Disk delta is measured via a named Docker volume mounted at /output.
 * CPU/memory stats are null — ephemeral containers exit too fast to sample.
 */
async function runWgetScenario(
  opts: ReturnType<typeof parseArgs>,
  urls: string[],
  scenarioName: string,
): Promise<ScenarioResult> {
  console.log(`  wget — ${scenarioName} (${urls.length} URL${urls.length > 1 ? "s" : ""})`);

  const network = `${opts.composeProject}_bench_net`;
  const volume = `wget_bench_${Date.now()}`;

  // Create a Docker volume for output
  await Bun.spawn(["docker", "volume", "create", volume], { stdout: "pipe", stderr: "pipe" })
    .exited;

  // Measure disk before (empty volume = 0)
  const diskBefore = 0;

  const start = performance.now();
  let successCount = 0;
  let failureCount = 0;

  for (const url of urls) {
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
      if (code === 0) {
        successCount++;
      } else {
        failureCount++;
      }
    } catch {
      failureCount++;
    }
  }

  const wallMs = Math.round(performance.now() - start);

  // Measure disk used by the volume
  let diskAfter: number | null = null;
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
    diskAfter = Number.isNaN(kb) ? null : kb;
  } catch {
    diskAfter = null;
  }

  // Cleanup volume
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
      diskDeltaKb: diskAfter !== null ? diskAfter - diskBefore : null,
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
 * Like the wget runner, CPU/memory stats are null for ephemeral containers.
 */
async function runMonolithScenario(
  opts: ReturnType<typeof parseArgs>,
  urls: string[],
  scenarioName: string,
): Promise<ScenarioResult> {
  console.log(`  monolith — ${scenarioName} (${urls.length} URL${urls.length > 1 ? "s" : ""})`);

  const network = `${opts.composeProject}_bench_net`;
  const volume = `monolith_bench_${Date.now()}`;

  await Bun.spawn(["docker", "volume", "create", volume], { stdout: "pipe", stderr: "pipe" })
    .exited;

  const start = performance.now();
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i] as string;
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
          `/output/page-${i}.html`,
          "-s", // silent
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const code = await proc.exited;
      if (code === 0) {
        successCount++;
      } else {
        failureCount++;
      }
    } catch {
      failureCount++;
    }
  }

  const wallMs = Math.round(performance.now() - start);

  let diskAfter: number | null = null;
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
    diskAfter = Number.isNaN(kb) ? null : kb;
  } catch {
    diskAfter = null;
  }

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
  const systemOrder = ["webfrost", "archivebox", "wget", "monolith"];
  const presentSystems = [...new Set(run.scenarios.map((s) => s.system))].sort((a, b) => {
    const ai = systemOrder.indexOf(a);
    const bi = systemOrder.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const systemLabel: Record<string, string> = {
    webfrost: "WebFrost",
    archivebox: "ArchiveBox",
    wget: "wget",
    monolith: "monolith",
  };

  const competitors = presentSystems.filter((s) => s !== "webfrost").join(", ");

  const header = `
## WebFrost vs ${competitors || "Competitors"} — Head-to-Head Comparison

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
    const wfMs = resultsBySystem.get("webfrost")?.get(sc)?.metrics.wallMs ?? null;
    const urlCount =
      resultsBySystem.get("webfrost")?.get(sc)?.urlCount ??
      presentSystems
        .map((s) => resultsBySystem.get(s)?.get(sc)?.urlCount)
        .find((v) => v !== undefined) ??
      "?";

    const wallCols = presentSystems
      .map((s) => {
        const ms = resultsBySystem.get(s)?.get(sc)?.metrics.wallMs ?? null;
        return ms !== null ? fmtMs(ms) : "—";
      })
      .join(" | ");

    // Find fastest competitor to compare against WebFrost
    let vsLabel = "—";
    if (wfMs !== null) {
      const competitorMs = presentSystems
        .filter((s) => s !== "webfrost")
        .map((s) => resultsBySystem.get(s)?.get(sc)?.metrics.wallMs ?? null)
        .filter((v): v is number => v !== null);
      if (competitorMs.length > 0) {
        const bestCompetitor = Math.min(...competitorMs);
        const ratio = bestCompetitor / wfMs;
        vsLabel = ratio > 1 ? `${ratio.toFixed(1)}× faster` : `${(1 / ratio).toFixed(1)}× slower`;
      }
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
    "- wget runs as `docker run --rm alpine:3.20 wget --mirror --page-requisites --convert-links`.\n";
  table += "- monolith runs as `docker run --rm y2z/monolith <url> -o /output/page-N.html`.\n";
  table +=
    "- CPU/memory are point-in-time samples at ~800 ms intervals; true peak may be higher.\n";
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
  console.log(`Fixtures:   ${opts.fixtureUrl}`);
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

    if (!opts.skipWget) {
      const wgetResult = await runWgetScenario(opts, sc.urls, sc.name);
      results.push(wgetResult);
    }

    if (!opts.skipMonolith) {
      const monolithResult = await runMonolithScenario(opts, sc.urls, sc.name);
      results.push(monolithResult);
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
