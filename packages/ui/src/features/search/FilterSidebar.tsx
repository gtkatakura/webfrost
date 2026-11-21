import type { Tag } from "@webfrost/sdk";
import { X } from "lucide-react";
import type { ReactNode } from "react";

export const DATE_PRESETS = [
  { label: "Any time", days: null },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
] as const;

export const KNOWN_EXTRACTORS = ["warc", "readability", "pdf", "screenshot", "dom-snapshot"];
// The snapshot statuses the server stores (see packages/core/src/pipeline.ts).
export const STATUSES = ["done", "failed", "pending"] as const;

const STATUS_DOT: Record<string, string> = {
  done: "var(--status-success)",
  failed: "var(--status-danger)",
  pending: "var(--status-pending)",
};

export interface Filters {
  statuses: Set<string>;
  days: number | null;
  extractors: Set<string>;
  tags: Set<number>;
}

export const NO_FILTERS: Filters = {
  statuses: new Set(),
  days: null,
  extractors: new Set(),
  tags: new Set(),
};

export function hasFilters(f: Filters): boolean {
  return f.statuses.size > 0 || f.days !== null || f.extractors.size > 0 || f.tags.size > 0;
}

export function toggled<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1.5 mt-4 text-ui-xs font-bold tracking-wider text-mid uppercase">
      {children}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  dot?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-ui-sm transition-colors ${
        active
          ? "border-accent bg-accent/10 font-semibold text-high"
          : "border-border bg-transparent text-mid hover:border-border-strong hover:text-high"
      }`}
    >
      {dot && (
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ background: dot }}
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
}

/** Filters for the current page of results. They never reach the server (yet). */
export function FilterSidebar({
  filters,
  onChange,
  allTags,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  allTags: Tag[];
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="m-0 text-ui-sm font-bold tracking-wider text-mid uppercase">
          Filter this page
        </h2>
        {hasFilters(filters) && (
          <button
            type="button"
            onClick={() => onChange(NO_FILTERS)}
            className="inline-flex items-center gap-1 border-0 bg-transparent p-0 text-ui-xs text-mid hover:text-high"
          >
            <X size={10} aria-hidden="true" />
            Clear all
          </button>
        )}
      </div>
      <p className="m-0 rounded-md bg-overlay px-2.5 py-2 text-ui-xs leading-snug text-mid">
        These filters apply to the current page of results only. They do not search the rest of your
        archive.
      </p>

      <SectionLabel>Status</SectionLabel>
      <div className="flex flex-col items-start gap-1">
        {STATUSES.map((s) => (
          <FilterChip
            key={s}
            active={filters.statuses.has(s)}
            dot={STATUS_DOT[s]}
            onClick={() => onChange({ ...filters, statuses: toggled(filters.statuses, s) })}
          >
            {s}
          </FilterChip>
        ))}
      </div>

      <SectionLabel>Date</SectionLabel>
      <div className="flex flex-col items-start gap-1">
        {DATE_PRESETS.map(({ label, days }) => (
          <FilterChip
            key={label}
            active={filters.days === days}
            onClick={() => onChange({ ...filters, days })}
          >
            {label}
          </FilterChip>
        ))}
      </div>

      <SectionLabel>Has extractor</SectionLabel>
      <div className="flex flex-col items-start gap-1">
        {KNOWN_EXTRACTORS.map((ext) => (
          <FilterChip
            key={ext}
            active={filters.extractors.has(ext)}
            onClick={() => onChange({ ...filters, extractors: toggled(filters.extractors, ext) })}
          >
            {ext}
          </FilterChip>
        ))}
      </div>

      {allTags.length > 0 && (
        <>
          <SectionLabel>Tags</SectionLabel>
          <div className="flex flex-col items-start gap-1">
            {allTags.map((tag) => (
              <FilterChip
                key={tag.id}
                active={filters.tags.has(tag.id)}
                dot={tag.color ?? undefined}
                onClick={() => onChange({ ...filters, tags: toggled(filters.tags, tag.id) })}
              >
                {tag.name}
              </FilterChip>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
