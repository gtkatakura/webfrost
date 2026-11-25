import type { SnapshotFilters, SnapshotStatus, Tag } from "@webfrost/sdk";
import { Check, X } from "lucide-react";
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

/** The URL parameters the filters live in, so Back, a reload or a shared link keep them. */
const PARAMS = { statuses: "status", days: "days", extractors: "extractor", tags: "tag" } as const;

function listOf(params: URLSearchParams, key: string): string[] {
  return (params.get(key) ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/** The filters a URL carries. Values the sidebar does not offer are ignored. */
export function filtersFromParams(params: URLSearchParams): Filters {
  const days = Number(params.get(PARAMS.days));
  return {
    statuses: new Set(
      listOf(params, PARAMS.statuses).filter((s) => (STATUSES as readonly string[]).includes(s)),
    ),
    days: DATE_PRESETS.some((preset) => preset.days === days) ? days : null,
    extractors: new Set(
      listOf(params, PARAMS.extractors).filter((e) => KNOWN_EXTRACTORS.includes(e)),
    ),
    tags: new Set(
      listOf(params, PARAMS.tags)
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  };
}

/** `params` with the filters written in (and removed where they filter nothing). */
export function withFilters(params: URLSearchParams, filters: Filters): URLSearchParams {
  const next = new URLSearchParams(params);
  const put = (key: string, values: readonly (string | number)[]) => {
    if (values.length > 0) next.set(key, values.join(","));
    else next.delete(key);
  };
  put(PARAMS.statuses, [...filters.statuses]);
  put(PARAMS.days, filters.days === null ? [] : [filters.days]);
  put(PARAMS.extractors, [...filters.extractors]);
  put(PARAMS.tags, [...filters.tags]);
  return next;
}

/** The first day of "the last N days", as a date (UTC), which stays the same all day long. */
function dateFromDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** The filters as the search request sends them to the server. */
export function toSnapshotFilters(filters: Filters): SnapshotFilters {
  return {
    ...(filters.statuses.size > 0 ? { status: [...filters.statuses] as SnapshotStatus[] } : {}),
    ...(filters.days !== null ? { since: dateFromDays(filters.days) } : {}),
    ...(filters.extractors.size > 0 ? { extractors: [...filters.extractors] } : {}),
    ...(filters.tags.size > 0 ? { tags: [...filters.tags] } : {}),
  };
}

export function toggled<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="label-caps mb-1 mt-5 px-2">{children}</h3>;
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
  dot?: string | undefined;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-8 w-full items-center gap-2 rounded-md border-0 px-2 text-left text-ui-sm transition-colors ${
        active
          ? "bg-accent/10 font-medium text-high"
          : "bg-transparent text-mid hover:bg-subtle hover:text-high"
      }`}
    >
      {dot && (
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: dot }}
          aria-hidden="true"
        />
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {active && <Check size={14} className="shrink-0 text-accent" aria-hidden="true" />}
    </button>
  );
}

/** Filters for the search. The server applies them, so they narrow every result, on any page. */
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
      <div className="mb-2 flex min-h-7 items-center justify-between px-2">
        <h2 className="m-0 text-ui-base font-semibold text-high">Filters</h2>
        {hasFilters(filters) && (
          <button
            type="button"
            onClick={() => onChange(NO_FILTERS)}
            className="inline-flex h-7 items-center gap-1 rounded-md border-0 bg-transparent px-1.5 text-ui-xs text-mid hover:bg-subtle hover:text-high"
          >
            <X size={12} aria-hidden="true" />
            Clear all
          </button>
        )}
      </div>

      <SectionLabel>Status</SectionLabel>
      <div className="flex flex-col gap-0.5">
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
      <div className="flex flex-col gap-0.5">
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
      <div className="flex flex-col gap-0.5">
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
          <div className="flex flex-col gap-0.5">
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
