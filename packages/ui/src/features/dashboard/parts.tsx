import type { Snapshot } from "@webfrost/sdk";
import { CircleCheckBig, CircleX, Clock } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
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

export function SnapshotStatusBadge({ status }: { status: string }) {
  const tone =
    status === "done"
      ? "bg-success/10 text-success"
      : status === "failed"
        ? "bg-danger/10 text-danger"
        : "bg-warning/10 text-warning";
  const Icon = status === "done" ? CircleCheckBig : status === "failed" ? CircleX : Clock;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-ui-sm font-medium ${tone}`}
    >
      <Icon size={10} aria-hidden="true" />
      {status}
    </span>
  );
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
      className={`flex flex-col gap-3 rounded-xl border p-5 ${
        danger ? "border-danger/40 bg-danger/10" : "border-border bg-surface"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={danger ? "text-danger" : "text-low"}>{icon}</span>
        <span className="text-ui-sm font-semibold tracking-wider text-mid uppercase">{label}</span>
      </div>
      {loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-3 w-20" />
        </div>
      ) : (
        <>
          <div
            className={`text-2xl font-bold leading-none ${danger ? "text-danger" : "text-high"}`}
          >
            {value}
          </div>
          {sub && <div className="text-ui-sm leading-tight text-mid">{sub}</div>}
        </>
      )}
    </div>
  );
}

const panel = "overflow-hidden rounded-xl border border-border bg-surface";

export function PipelineSection({
  loading,
  pending,
}: {
  loading: boolean;
  pending: Snapshot[];
}) {
  return (
    <section className="mb-8" aria-labelledby="pipeline-heading">
      <h2
        id="pipeline-heading"
        className="mb-3 mt-0 text-ui-base font-semibold tracking-wider text-mid uppercase"
      >
        Pipeline
      </h2>
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
                  size={13}
                  className="shrink-0 animate-pulse text-warning"
                  aria-hidden="true"
                />
                <Link
                  to={`/snapshots/${s.id}`}
                  className="truncate text-ui-base text-high"
                  title={s.url}
                >
                  {s.url}
                </Link>
              </div>
              <div className="flex flex-wrap gap-1 pl-5">
                {s.extractors.length > 0 ? (
                  <>
                    {s.extractors.map((ext) => (
                      <span
                        key={ext}
                        className="rounded bg-success/10 px-2 py-0.5 text-ui-sm font-medium text-success"
                      >
                        ✓ {ext}
                      </span>
                    ))}
                    <span className="rounded bg-overlay px-2 py-0.5 text-ui-sm text-mid">
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

export function ActivityFeed({
  loading,
  groups,
}: {
  loading: boolean;
  groups: Array<{ label: string; items: Snapshot[] }>;
}) {
  return (
    <section aria-labelledby="activity-heading">
      <div className="mb-3 flex items-center justify-between">
        <h2
          id="activity-heading"
          className="m-0 text-ui-base font-semibold tracking-wider text-mid uppercase"
        >
          Recent Activity
        </h2>
        <Link to="/snapshots" className="text-ui-sm">
          View all →
        </Link>
      </div>

      {loading ? (
        <div className={`${panel} flex flex-col gap-4 p-4`}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-5 w-24" />
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
            <div key={label}>
              <div className="border-b border-border bg-overlay px-4 py-2 text-ui-sm font-semibold tracking-wider text-mid uppercase">
                {label}
              </div>
              {items.map((s) => (
                <div
                  key={s.id}
                  className="flex items-start gap-3 border-b border-border px-4 py-3 transition-colors last:border-0 hover:bg-subtle"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/snapshots/${s.id}`}
                      className="block truncate text-ui-base text-high hover:text-accent"
                      title={s.url}
                    >
                      {s.url}
                    </Link>
                    {s.extractors.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {s.extractors.map((ext) => (
                          <span
                            key={ext}
                            className="rounded bg-overlay px-1.5 py-0.5 text-ui-sm font-medium text-mid"
                          >
                            {ext}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <SnapshotStatusBadge status={s.status} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
