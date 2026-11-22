import mascot from "@/assets/brand/mascot.webp?preset=hero";
import { FeatureGrid, type Tile } from "@/components/features";
import { type CodeTab, CodeWindow, GitHubMark, SplitDeveloperHero } from "@/components/hero";
import { Picture } from "@/components/picture";
import { baseOptions } from "@/lib/layout.shared";
import { repoUrl } from "@/lib/shared";
import { shareMeta } from "@/lib/site";
import { sdkPublished } from "@/lib/unpublished";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import {
  Archive,
  Braces,
  CalendarClock,
  Code2,
  Container,
  Database,
  Eye,
  LayoutDashboard,
  ShieldCheck,
  Terminal,
  Webhook,
} from "lucide-react";

export function meta() {
  return [
    { title: "WebFrost · self-hosted web archiving" },
    {
      name: "description",
      content:
        "Archive web pages to WARC, PDF, screenshots, self-contained HTML and readable text, on your own machine. CLI, HTTP API, TypeScript SDK and web UI.",
    },
    ...shareMeta({
      title: "WebFrost · self-hosted web archiving",
      description: "Archive web pages to every format worth keeping, on your own machine.",
      path: "/",
    }),
  ];
}

const allCodeTabs: CodeTab[] = [
  {
    label: "Docker",
    language: "bash",
    icon: <Container className="size-3.5" strokeWidth={1.8} />,
    code: `curl -fsSLO https://webfrost.dev/compose.yml
echo "SESSION_SECRET=$(openssl rand -hex 32)" > .env
docker compose up -d
# open http://localhost:3000 and create the admin user`,
  },
  {
    label: "CLI",
    language: "bash",
    icon: <Terminal className="size-3.5" strokeWidth={1.8} />,
    code: `curl -fsSL https://webfrost.dev/install.sh | sh
webfrost add https://example.com
webfrost search "example domain"
webfrost import bookmarks.html`,
  },
  {
    label: "SDK",
    language: "typescript",
    icon: <Braces className="size-3.5" strokeWidth={1.8} />,
    code: `import { WebFrostClient } from "@webfrost/sdk";

const client = new WebFrostClient({
  baseUrl: "http://localhost:3000",
  apiKey: process.env.WEBFROST_API_KEY,
});

const { id } = await client.createSnapshot("https://example.com");
const hits = await client.searchSnapshotsPage("archiving");`,
  },
];

const pillars: Tile[] = [
  {
    icon: Archive,
    label: "Every format from one visit",
    body: "One fetch and one browser navigation produce WARC, raw HTML, readable text, PDF, a full-page screenshot, the rendered DOM, a self-contained HTML file and, for media pages, the video.",
    accent: "text-[var(--tint-1)]",
    href: "/docs/reference/extractors",
  },
  {
    icon: CalendarClock,
    label: "Keeps running on its own",
    body: "Cron schedules and RSS feeds run inside the server. Jobs are queued with a concurrency limit, retried after a crash, and spaced out per site so nobody gets hammered.",
    accent: "text-[var(--tint-2)]",
    href: "/docs/guides/scheduled-archiving",
  },
  {
    icon: ShieldCheck,
    label: "Safe to put on a network",
    body: "Sessions you can revoke, API keys, rate limits, and a guard that stops archived pages — and the browser rendering them — from reaching your internal network.",
    accent: "text-[var(--tint-3)]",
    href: "/docs/architecture/security",
  },
  {
    icon: Database,
    label: "Plain files, no lock-in",
    body: "An archive is a folder: one SQLite database and the files next to it, or an S3-compatible bucket. Copy it, back it up, read it with any tool.",
    accent: "text-[var(--tint-4)]",
    href: "/docs/architecture/storage-model",
  },
];

const allSurfaces: Tile[] = [
  {
    icon: Terminal,
    label: "CLI",
    body: "Archive, import, search and schedule from a terminal, straight against an archive folder.",
    accent: "text-[var(--tint-1)]",
    href: "/docs/reference/cli",
  },
  {
    icon: Webhook,
    label: "HTTP API",
    body: "Everything the UI does, over REST, with API keys for scripts and integrations.",
    accent: "text-[var(--tint-2)]",
    href: "/docs/reference/rest-api",
  },
  {
    icon: Code2,
    label: "TypeScript SDK",
    body: "A typed client with no dependencies, for Bun, Node and the browser.",
    accent: "text-[var(--tint-3)]",
    href: "/docs/reference/sdk",
  },
  {
    icon: LayoutDashboard,
    label: "Web UI",
    body: "Dashboard, search with highlights, previews of every format, tags, schedules and imports.",
    accent: "text-[var(--tint-4)]",
    href: "/docs/reference/web-ui",
  },
];

// The SDK is shown once @webfrost/sdk is on npm (see lib/unpublished.ts).
const codeTabs = sdkPublished ? allCodeTabs : allCodeTabs.filter((tab) => tab.label !== "SDK");
const surfaces = sdkPublished
  ? allSurfaces
  : allSurfaces.filter((tile) => tile.label !== "TypeScript SDK");

export default function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="flex-1">
        <SplitDeveloperHero
          badge="Open Source"
          title={
            <>
              Keep the web pages <span className="text-frost">you care about</span>.
            </>
          }
          description="WebFrost archives a URL to every format worth keeping, on your own machine, and lets you search what you saved. Run it from a terminal, a script or a browser."
          primaryAction={{ label: "Get started", href: "/docs/getting-started/quickstart" }}
          secondaryAction={{
            label: "Live demo",
            href: "https://demo.webfrost.dev/#/snapshots",
            external: true,
            icon: <Eye className="size-4" aria-hidden="true" />,
          }}
          tertiaryAction={{
            label: "View on GitHub",
            href: repoUrl,
            external: true,
            icon: <GitHubMark className="size-4" />,
          }}
          art={
            <Picture
              image={mascot}
              priority
              sizes="(min-width: 1024px) 544px, calc(100vw - 48px)"
              alt="The WebFrost mascot, an arctic fox asleep on a frozen archive box, surrounded by the formats it keeps: a web page, a PDF, a video, a screenshot and source code."
              className="rounded-3xl border border-border bg-[#05091a] shadow-2xl shadow-blue-900/20"
            />
          }
        />
        <section className="py-12 sm:py-16">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 lg:grid-cols-[2fr_3fr]">
            <div>
              <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                Up in a minute
              </span>
              <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                Start the server, or just use the CLI.
              </h2>
              <p className="mt-4 text-pretty text-muted-foreground">
                The Docker image bundles Chromium, yt-dlp and ffmpeg, so every format works out of
                the box. The same archive folder works from the CLI and from code.
              </p>
            </div>
            <CodeWindow tabs={codeTabs} />
          </div>
        </section>
        <FeatureGrid
          eyebrow="What it does"
          title="Archive once, keep it in every shape."
          tiles={pillars}
        />
        <FeatureGrid
          eyebrow={surfaces.length === 4 ? "Four ways in" : "Three ways in"}
          title="Use it the way that fits."
          tiles={surfaces}
          columns={surfaces.length === 4 ? 4 : 3}
        />
        <section className="mx-auto max-w-6xl px-6 pt-4 pb-24">
          <div className="flex flex-col items-start gap-4 rounded-2xl border border-border bg-card px-6 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <div className="flex items-start gap-4">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-muted text-[var(--tint-1)]">
                <Eye className="size-5" strokeWidth={1.6} />
              </div>
              <div>
                <h2 className="font-semibold">Share an archive without sharing the keys</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Public read mode lets anyone browse and search; only you can archive, delete or
                  change settings.
                </p>
              </div>
            </div>
            <a
              href="/docs/guides/public-read"
              className="inline-flex h-10 shrink-0 items-center rounded-xl border border-border px-4 text-sm font-medium hover:bg-accent"
            >
              How public read works
            </a>
          </div>
        </section>
      </main>
    </HomeLayout>
  );
}
