#!/usr/bin/env bun
/**
 * bench/vs-archivebox/chart.ts
 *
 * Generates bench/vs-archivebox/results/report.html from the latest JSON results.
 * Produces inline SVG bar charts comparing wall-time, memory, and disk usage
 * across all benchmark systems (WebFrost, ArchiveBox, wget, monolith, …).
 *
 * Usage:
 *   bun bench/vs-archivebox/chart.ts [--input <path>] [--output <path>]
 *
 * Defaults:
 *   --input   bench/vs-archivebox/results/latest.json
 *   --output  bench/vs-archivebox/results/report.html
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_INPUT = resolve(import.meta.dir, "results/latest.json");
const DEFAULT_OUTPUT = resolve(import.meta.dir, "results/report.html");

function parseArgs(): { input: string; output: string } {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? (args[i + 1] as string) : fallback;
  };
  return { input: get("--input", DEFAULT_INPUT), output: get("--output", DEFAULT_OUTPUT) };
}

// ---------------------------------------------------------------------------
// Types (mirrors run.ts output)
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
  metrics: Metrics;
  successCount: number;
  failureCount: number;
}

interface BenchmarkRun {
  date: string;
  fixtureUrl?: string;
  scenarios: ScenarioResult[];
}

// ---------------------------------------------------------------------------
// Chart colours per system
// ---------------------------------------------------------------------------

const SYSTEM_COLORS: Record<string, string> = {
  webfrost: "#3b82f6",
  archivebox: "#f97316",
  wget: "#10b981",
  "wget-parallel": "#059669",
  monolith: "#8b5cf6",
  "monolith-parallel": "#6d28d9",
};

function systemColor(sys: string): string {
  return SYSTEM_COLORS[sys] ?? "#6b7280";
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtMs(n: number): string {
  if (n >= 60_000) return `${(n / 60_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}s`;
  return `${n}ms`;
}

function fmtNum(n: number | null, unit = ""): string {
  return n === null ? "—" : `${n}${unit}`;
}

// ---------------------------------------------------------------------------
// SVG bar chart generator
// ---------------------------------------------------------------------------

interface Dataset {
  label: string;
  values: (number | null)[];
}

function svgBarChart(
  title: string,
  xLabels: string[],
  datasets: Dataset[],
  yUnit: string,
  width = 760,
  height = 300,
): string {
  const padL = 70;
  const padR = 20;
  const padT = 36;
  const padB = 72;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  const allVals = datasets.flatMap((d) => d.values).filter((v): v is number => v !== null);
  const maxVal = Math.max(...allVals, 1);

  const groupW = chartW / xLabels.length;
  const barW = Math.min((groupW / datasets.length) * 0.72, 36);
  const barGap = (groupW - barW * datasets.length) / 2;

  let bars = "";
  let xAxis = "";
  let legend = "";

  for (let gi = 0; gi < xLabels.length; gi++) {
    const gx = padL + gi * groupW;
    xAxis +=
      `<text x="${(gx + groupW / 2).toFixed(1)}" y="${height - padB + 16}" ` +
      `text-anchor="middle" font-size="10" fill="#6b7280">${xLabels[gi]}</text>`;

    for (let di = 0; di < datasets.length; di++) {
      const ds = datasets[di] as Dataset;
      const val = ds.values[gi];
      if (val === null || val === undefined) continue;
      const bh = Math.max((val / maxVal) * chartH, 1);
      const bx = gx + barGap + di * barW;
      const by = padT + chartH - bh;
      const c = systemColor(ds.label);
      bars += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" fill="${c}" rx="2" opacity="0.9"/>`;
      if (bh > 14) {
        bars +=
          `<text x="${(bx + barW / 2).toFixed(1)}" y="${(by + bh - 3).toFixed(1)}" ` +
          `text-anchor="middle" font-size="8" fill="white">${fmtMs(val)}</text>`;
      }
    }
  }

  // Y-axis gridlines + labels
  let yAxis = "";
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const val = (maxVal / ticks) * i;
    const y = (padT + chartH - (val / maxVal) * chartH).toFixed(1);
    yAxis +=
      `<line x1="${padL - 4}" y1="${y}" x2="${padL + chartW}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>` +
      `<text x="${padL - 6}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="#9ca3af">${fmtMs(Math.round(val))}</text>`;
  }

  // Legend row
  const legendItemW = Math.min(120, chartW / datasets.length);
  for (let di = 0; di < datasets.length; di++) {
    const ds = datasets[di] as Dataset;
    const lx = padL + di * legendItemW;
    const ly = height - 14;
    legend +=
      `<rect x="${lx}" y="${ly - 9}" width="11" height="11" fill="${systemColor(ds.label)}" rx="2"/>` +
      `<text x="${lx + 15}" y="${ly}" font-size="10" fill="#374151">${ds.label}</text>`;
  }

  // Y-axis unit label
  const unitLabel =
    `<text x="12" y="${(padT + chartH / 2).toFixed(1)}" ` +
    `transform="rotate(-90,12,${(padT + chartH / 2).toFixed(1)})" ` +
    `text-anchor="middle" font-size="9" fill="#9ca3af">${yUnit}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" style="font-family:system-ui,sans-serif;display:block"><text x="${width / 2}" y="22" text-anchor="middle" font-size="13" font-weight="600" fill="#111827">${title}</text>${yAxis}<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + chartH}" stroke="#d1d5db" stroke-width="1"/>${bars}${xAxis}${legend}${unitLabel}</svg>`;
}

// ---------------------------------------------------------------------------
// HTML report generator
// ---------------------------------------------------------------------------

function generateHtml(run: BenchmarkRun): string {
  const date = run.date.split("T")[0] ?? run.date;

  const systemOrder = [
    "webfrost",
    "archivebox",
    "wget",
    "wget-parallel",
    "monolith",
    "monolith-parallel",
  ];
  const allSystems = [...new Set(run.scenarios.map((s) => s.system))].sort((a, b) => {
    const ai = systemOrder.indexOf(a);
    const bi = systemOrder.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const allScenarios = [...new Set(run.scenarios.map((s) => s.scenario))];

  // Helper: lookup a result
  const lookup = (sys: string, sc: string): ScenarioResult | undefined =>
    run.scenarios.find((r) => r.system === sys && r.scenario === sc);

  // A scenario result is invalid if it archived nothing (success=0)
  const isInvalid = (r: ScenarioResult | undefined): boolean =>
    r !== undefined && r.successCount === 0;

  // Build datasets for each metric — null out invalid results so bars are omitted
  const wallDatasets: Dataset[] = allSystems.map((sys) => ({
    label: sys,
    values: allScenarios.map((sc) => {
      const r = lookup(sys, sc);
      return isInvalid(r) ? null : (r?.metrics.wallMs ?? null);
    }),
  }));
  const memDatasets: Dataset[] = allSystems.map((sys) => ({
    label: sys,
    values: allScenarios.map((sc) => {
      const r = lookup(sys, sc);
      return isInvalid(r) ? null : (r?.metrics.peakMemMb ?? null);
    }),
  }));
  const diskDatasets: Dataset[] = allSystems.map((sys) => ({
    label: sys,
    values: allScenarios.map((sc) => {
      const r = lookup(sys, sc);
      return isInvalid(r) ? null : (r?.metrics.diskDeltaKb ?? null);
    }),
  }));

  const wallChart = svgBarChart("Wall Time by Scenario", allScenarios, wallDatasets, "wall time");
  const memChart = svgBarChart("Peak Memory (MB)", allScenarios, memDatasets, "MB");
  const diskChart = svgBarChart("Disk Delta (KB)", allScenarios, diskDatasets, "KB");

  // Summary table
  const thSystems = allSystems.map((s) => `<th style="color:${systemColor(s)}">${s}</th>`).join("");
  let tableRows = "";
  for (const sc of allScenarios) {
    const urlCount =
      allSystems.map((s) => lookup(s, sc)?.urlCount).find((v) => v !== undefined) ?? "?";
    const wallCells = allSystems
      .map((s) => {
        const r = lookup(s, sc);
        if (!r) return "<td>—</td>";
        if (isInvalid(r))
          return `<td style="color:#ef4444;text-decoration:line-through" title="INVALID: success=0">${fmtMs(r.metrics.wallMs)} ⚠</td>`;
        return `<td>${fmtMs(r.metrics.wallMs)}</td>`;
      })
      .join("");
    const memCells = allSystems
      .map((s) => `<td>${fmtNum(lookup(s, sc)?.metrics.peakMemMb ?? null, " MB")}</td>`)
      .join("");
    const diskCells = allSystems
      .map((s) => `<td>${fmtNum(lookup(s, sc)?.metrics.diskDeltaKb ?? null, " KB")}</td>`)
      .join("");
    tableRows +=
      `<tr><td class="sc">${sc}</td><td>${urlCount}</td>${wallCells}</tr>` +
      `<tr class="sub"><td></td><td>mem</td>${memCells}</tr>` +
      `<tr class="sub"><td></td><td>disk Δ</td>${diskCells}</tr>`;
  }

  const table = `<table>
<thead><tr><th>Scenario</th><th></th>${thSystems}</tr></thead>
<tbody>${tableRows}</tbody>
</table>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WebFrost Benchmark Report — ${date}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#f9fafb;color:#111827;padding:2rem;max-width:860px;margin:0 auto}
h1{font-size:1.4rem;font-weight:700;margin-bottom:.25rem}
.meta{color:#6b7280;font-size:.85rem;margin-bottom:2rem}
.charts{display:grid;gap:1.5rem;margin-bottom:2rem}
.chart{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:1rem;overflow-x:auto}
h2{font-size:1rem;font-weight:600;margin-bottom:1rem}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-size:.82rem}
th{background:#f3f4f6;padding:.5rem .75rem;text-align:left;font-weight:600;color:#374151}
td{padding:.35rem .75rem;border-top:1px solid #f3f4f6;color:#374151}
td.sc{font-weight:500}
tr.sub td{color:#9ca3af;font-size:.78rem;border-top:none}
</style>
</head>
<body>
<h1>WebFrost Benchmark Report</h1>
<p class="meta">Generated: ${run.date}${run.fixtureUrl ? ` &middot; Fixture: ${run.fixtureUrl}` : ""}</p>
<div class="charts">
  <div class="chart">${wallChart}</div>
  <div class="chart">${memChart}</div>
  <div class="chart">${diskChart}</div>
</div>
<h2>Full Results</h2>
${table}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const opts = parseArgs();

if (!existsSync(opts.input)) {
  console.error(`Input not found: ${opts.input}`);
  console.error("Run the benchmark first: bun bench/vs-archivebox/run.ts");
  process.exit(1);
}

const run: BenchmarkRun = JSON.parse(readFileSync(opts.input, "utf-8")) as BenchmarkRun;
const html = generateHtml(run);

mkdirSync(dirname(opts.output), { recursive: true });
writeFileSync(opts.output, html);
console.log(`Chart report written to: ${opts.output}`);
