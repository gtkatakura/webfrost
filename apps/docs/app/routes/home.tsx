import { FeatureGrid, type Tile } from "@/components/features";
import { type CodeTab, SplitDeveloperHero } from "@/components/hero";
import { baseOptions } from "@/lib/layout.shared";
import { repoUrl } from "@/lib/shared";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import {
  Archive,
  CalendarClock,
  Code2,
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
  ];
}

const codeTabs: CodeTab[] = [
  {
    label: "Docker",
    language: "bash",
    code: `echo "SESSION_SECRET=$(openssl rand -hex 32)" > .env
docker compose -f docker-compose.prod.yml up -d
# open http://localhost:3000 and create the admin user`,
  },
  {
    label: "CLI",
    language: "bash",
    code: `export WEBFROST_DIR=./archive
bun run webfrost add https://example.com
bun run webfrost search "example domain"
bun run webfrost import bookmarks.html`,
  },
  {
    label: "SDK",
    language: "typescript",
    code: `import { WebFrostClient } from "@webfrost/sdk";

const client = new WebFrostClient({
  baseUrl: "http://localhost:3000/api",
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
    accent: "text-violet-500",
    href: "/docs/reference/extractors",
  },
  {
    icon: CalendarClock,
    label: "Keeps running on its own",
    body: "Cron schedules and RSS feeds run inside the server. Jobs are queued with a concurrency limit, retried after a crash, and spaced out per site so nobody gets hammered.",
    accent: "text-sky-500",
    href: "/docs/guides/scheduled-archiving",
  },
  {
    icon: ShieldCheck,
    label: "Safe to put on a network",
    body: "Sessions you can revoke, API keys, rate limits, and a guard that stops archived pages — and the browser rendering them — from reaching your internal network.",
    accent: "text-emerald-500",
    href: "/docs/architecture/security",
  },
  {
    icon: Database,
    label: "Plain files, no lock-in",
    body: "An archive is a folder: one SQLite database and the files next to it, or an S3-compatible bucket. Copy it, back it up, read it with any tool.",
    accent: "text-amber-500",
    href: "/docs/architecture/storage-model",
  },
];

const surfaces: Tile[] = [
  {
    icon: Terminal,
    label: "CLI",
    body: "Archive, import, search and schedule from a terminal, straight against an archive folder.",
    accent: "text-violet-500",
    href: "/docs/reference/cli",
  },
  {
    icon: Webhook,
    label: "HTTP API",
    body: "Everything the UI does, over REST, with API keys for scripts and integrations.",
    accent: "text-sky-500",
    href: "/docs/reference/rest-api",
  },
  {
    icon: Code2,
    label: "TypeScript SDK",
    body: "A typed client with no dependencies, for Bun, Node and the browser.",
    accent: "text-emerald-500",
    href: "/docs/reference/sdk",
  },
  {
    icon: LayoutDashboard,
    label: "Web UI",
    body: "Dashboard, search with highlights, previews of every format, tags, schedules and imports.",
    accent: "text-amber-500",
    href: "/docs/guides/web-ui",
  },
];

export default function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="flex-1">
        <SplitDeveloperHero
          badge="Self-hosted · open source · MIT"
          title={
            <>
              Keep the web pages <span className="text-primary">you care about</span>.
            </>
          }
          description="WebFrost archives a URL to every format worth keeping, on your own machine, and lets you search what you saved. Run it from a terminal, a script or a browser."
          primaryAction={{ label: "Get started", href: "/docs/getting-started/quickstart" }}
          secondaryAction={{ label: "View on GitHub", href: repoUrl, external: true }}
          codeTabs={codeTabs}
        />
        <FeatureGrid
          eyebrow="What it does"
          title="Archive once, keep it in every shape."
          tiles={pillars}
        />
        <FeatureGrid
          eyebrow="Four ways in"
          title="Use it the way that fits."
          tiles={surfaces}
          columns={4}
        />
        <section className="mx-auto max-w-6xl px-6 pt-4 pb-24">
          <div className="flex flex-col items-start gap-4 rounded-2xl border border-border bg-card px-6 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <div className="flex items-start gap-4">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-muted text-violet-500">
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
