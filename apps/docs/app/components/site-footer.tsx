import { author, demoUrl, repoUrl } from "@/lib/shared";

/** The author line, under the docs sidebar and at the bottom of the home page. */
export function AuthorCredit({ className = "" }: { className?: string }) {
  return (
    <p className={`m-0 text-xs text-fd-muted-foreground ${className}`}>
      Made by{" "}
      <a
        href={author.url}
        className="font-medium text-fd-foreground/80 underline-offset-4 hover:text-fd-foreground hover:underline"
      >
        {author.name}
      </a>
    </p>
  );
}

const LINKS = [
  { label: "Documentation", href: "/docs" },
  { label: "Live demo", href: demoUrl },
  { label: "GitHub", href: repoUrl },
  { label: "Releases", href: `${repoUrl}/releases` },
];

/** The home page footer: where to go next, the license and who made it. */
export function SiteFooter() {
  return (
    <footer className="border-t border-fd-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-fd-muted-foreground no-underline transition-colors hover:text-fd-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex flex-col gap-1 text-xs text-fd-muted-foreground sm:items-end">
          <AuthorCredit />
          <p className="m-0">Open source, MIT license</p>
        </div>
      </div>
    </footer>
  );
}
