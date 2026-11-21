/*
 * Adapted from "Bento Feature Grid" by ln-dev7 on 21st.dev (https://21st.dev/@ln-dev7/components/bento-01).
 * Changes: tiles come from props, each can link to the page that explains it, and they rise in on load.
 */
import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import { Link } from "react-router";

export interface Tile {
  icon: LucideIcon;
  label: string;
  body: string;
  accent: string;
  href?: string;
}

export function FeatureGrid({
  eyebrow,
  title,
  tiles,
  columns = 2,
}: {
  eyebrow: string;
  title: string;
  tiles: Tile[];
  columns?: 2 | 3 | 4;
}) {
  const grid = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
  }[columns];
  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-10 max-w-lg">
          <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            {eyebrow}
          </span>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h2>
        </div>
        <div className={`grid grid-cols-1 gap-4 ${grid}`}>
          {tiles.map((tile, i) => (
            <TileCard key={tile.label} tile={tile} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function TileCard({ tile, index }: { tile: Tile; index: number }) {
  const { icon: Icon, label, body, accent, href } = tile;
  const inner = (
    <>
      <div
        className={`grid size-10 place-items-center rounded-xl border border-border bg-muted ${accent}`}
      >
        <Icon className="size-5" strokeWidth={1.6} />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground">{label}</h3>
        <p className="mt-1.5 text-pretty text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </>
  );
  const className =
    "rise flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 transition-colors sm:p-7";
  const style = { "--i": index } as React.CSSProperties;
  return href ? (
    <Link
      to={href}
      className={`${className} hover:border-primary/50 hover:bg-accent/40`}
      style={style}
    >
      {inner}
    </Link>
  ) : (
    <div className={className} style={style}>
      {inner}
    </div>
  );
}
