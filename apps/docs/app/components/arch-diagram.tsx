import diagrams from "@/lib/diagrams.json";
import { ExternalLink } from "lucide-react";

const sizes: Record<string, { width: number; height: number } | undefined> = diagrams;

/** Narrowest a diagram is drawn: on a phone it scrolls sideways instead of shrinking past legibility. */
const MIN_WIDTH = 620;

/**
 * A diagram made with Archify (apps/docs/diagrams-src, published by scripts/diagrams.ts).
 *
 * Both theme variants are in the page and CSS shows the one matching the `dark` class, so the right one
 * is there on first paint and follows the theme toggle. Width and height reserve the space before the
 * image arrives; `loading="lazy"` keeps the hidden variant, and diagrams below the fold, from loading.
 * The interactive viewer (zoom, focus, links to the source) opens in a new tab.
 */
export function ArchDiagram({
  name,
  alt,
  caption,
}: {
  /** The folder name in apps/docs/diagrams-src. */
  name: string;
  /** What the diagram shows, for screen readers and when the image does not load. */
  alt: string;
  /** One line under the diagram. */
  caption?: string;
}) {
  const size = sizes[name];
  if (!size) throw new Error(`Unknown diagram "${name}": run bun apps/docs/scripts/diagrams.ts`);
  const { width, height } = size;
  const src = `/diagrams/${name}`;
  const image = "block h-auto w-full";

  return (
    <figure className="not-prose my-6">
      <div className="overflow-x-auto rounded-xl border border-fd-border">
        <div style={{ minWidth: Math.min(width, MIN_WIDTH) }}>
          <img
            src={`${src}.light.svg`}
            alt={alt}
            width={width}
            height={height}
            loading="lazy"
            decoding="async"
            className={`${image} dark:hidden`}
          />
          <img
            src={`${src}.dark.svg`}
            alt={alt}
            width={width}
            height={height}
            loading="lazy"
            decoding="async"
            className={`${image} hidden dark:block`}
          />
        </div>
      </div>
      <figcaption className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm text-fd-muted-foreground">
        {caption ? <span>{caption}</span> : null}
        <a
          href={`${src}.html`}
          target="_blank"
          rel="noreferrer"
          className="ms-auto inline-flex items-center gap-1 font-medium text-fd-primary hover:underline"
        >
          Open interactive diagram
          <ExternalLink aria-hidden="true" className="size-3.5" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </figcaption>
    </figure>
  );
}
