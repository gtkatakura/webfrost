import type { Snapshot } from "@webfrost/sdk";
import { Check, ChevronRight, Clock } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { StatusBadge } from "../../components/StatusBadge";
import { Skeleton } from "../../components/ui/StateViews";

function dayLabel(isoString: string): string {
  const date = new Date(isoString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
}

export function groupSnapshotsByDay(
  snapshots: Snapshot[],
): Array<{ label: string; items: Snapshot[] }> {
  const groups = new Map<string, Snapshot[]>();
  for (const s of snapshots) {
    const key = new Date(s.createdAt).toDateString();
    const group = groups.get(key);
    if (group) group.push(s);
    else groups.set(key, [s]);
  }
  return Array.from(groups.values(), (items) => ({
    label: dayLabel(items[0]?.createdAt ?? ""),
    items,
  }));
}

function timeOfDay(isoString: string): string {
  return new Date(isoString).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** "en.wikipedia.org/wiki/Arctic_fox": the address without the scheme, for a secondary line. */
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function StatCard({
  icon,
  label,
  value,
  sub,
  danger,
  loading,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  danger?: boolean;
  loading: boolean;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-2 rounded-xl border px-4 py-3.5 ${
        danger ? "border-danger/40 bg-danger/10" : "border-border bg-surface"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`hidden shrink-0 sm:flex ${danger ? "text-danger" : "text-low"}`}
          aria-hidden="true"
        >
          {icon}
        </span>
        <span className="label-caps truncate">{label}</span>
      </div>
      {loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-3 w-20" />
        </div>
      ) : (
        <>
          <div
            className={`text-ui-2xl font-semibold tabular-nums ${danger ? "text-danger" : "text-high"}`}
          >
            {value}
          </div>
          {sub && <div className="text-ui-sm text-mid">{sub}</div>}
        </>
      )}
    </div>
  );
}

const panel = "overflow-hidden rounded-xl border border-border bg-surface";
const sectionHeading = "label-caps m-0";

export function PipelineSection({
  loading,
  pending,
}: {
  loading: boolean;
  pending: Snapshot[];
}) {
  return (
    <section className="mb-8" aria-labelledby="pipeline-heading">
      <div className="mb-2.5 flex items-center gap-2">
        <h2 id="pipeline-heading" className={sectionHeading}>
          Pipeline
        </h2>
        {!loading && (
          <span className="rounded-full bg-warning/10 px-2 py-px text-ui-xs font-semibold tabular-nums text-warning">
            {pending.length}
          </span>
        )}
      </div>
      <div className={panel}>
        {loading ? (
          <div className="flex flex-col gap-4 p-4">
            {[1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-5 w-40" />
              </div>
            ))}
          </div>
        ) : (
          pending.map((s) => (
            <div key={s.id} className="border-b border-border px-4 py-3 last:border-0">
              <div className="mb-2 flex items-center gap-2">
                <Clock
                  size={14}
                  className="shrink-0 animate-pulse text-warning"
                  aria-hidden="true"
                />
                <Link
                  to={`/snapshots/${s.id}`}
                  className="min-w-0 truncate text-ui-base font-medium text-high"
                  title={s.url}
                >
                  {s.url}
                </Link>
              </div>
              <div className="flex flex-wrap gap-1 pl-[22px]">
                {s.extractors.length > 0 ? (
                  <>
                    {s.extractors.map((ext) => (
                      <span
                        key={ext}
                        className="inline-flex items-center gap-1 rounded bg-success/10 px-1.5 py-0.5 font-mono text-ui-xs text-success"
                      >
                        <Check size={11} aria-hidden="true" />
                        {ext}
                      </span>
                    ))}
                    <span className="rounded bg-overlay px-1.5 py-0.5 text-ui-xs text-mid">
                      processing…
                    </span>
                  </>
                ) : (
                  <span className="text-ui-sm text-mid">Extractors starting…</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ActivityRow({ snapshot: s }: { snapshot: Snapshot }) {
  const count = s.extractors.length;
  return (
    <li className="border-b border-border last:border-0">
      <Link
        to={`/snapshots/${s.id}`}
        title={s.url}
        className="flex items-center gap-3 px-4 py-2.5 text-inherit no-underline transition-colors hover:bg-subtle hover:no-underline"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          {s.title ? (
            <>
              <span className="truncate text-ui-base font-medium text-high">{s.title}</span>
              <span className="truncate font-mono text-ui-xs text-mid">{displayUrl(s.url)}</span>
            </>
          ) : (
            <span className="truncate text-ui-base font-medium text-high">{s.url}</span>
          )}
        </span>
        <span className="hidden shrink-0 text-ui-xs tabular-nums text-low sm:inline">
          {count > 0 ? `${count} ${count === 1 ? "extractor" : "extractors"}` : ""}
        </span>
        <span className="flex w-[4.75rem] shrink-0 flex-col items-end gap-0.5">
          <StatusBadge status={s.status} />
          <span className="text-ui-xs tabular-nums text-low">{timeOfDay(s.createdAt)}</span>
        </span>
      </Link>
    </li>
  );
}

export function ActivityFeed({
  loading,
  groups,
}: {
  loading: boolean;
  groups: Array<{ label: string; items: Snapshot[] }>;
}) {
  return (
    <section aria-labelledby="activity-heading">
      <div className="mb-2.5 flex items-center justify-between">
        <h2 id="activity-heading" className={sectionHeading}>
          Recent Activity
        </h2>
        <Link to="/snapshots" className="inline-flex items-center gap-0.5 text-ui-sm font-medium">
          View all
          <ChevronRight size={14} aria-hidden="true" />
        </Link>
      </div>

      {loading ? (
        <div className={`${panel} flex flex-col gap-4 p-4`}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className={`${panel} p-8 text-center text-ui-base text-mid`}>
          No completed snapshots yet
        </div>
      ) : (
        <div className={panel}>
          {groups.map(({ label, items }) => (
            <section key={label} aria-label={label}>
              <div className="label-caps border-b border-border bg-overlay px-4 py-1.5">
                {label}
              </div>
              <ul className="m-0 list-none p-0">
                {items.map((s) => (
                  <ActivityRow key={s.id} snapshot={s} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
