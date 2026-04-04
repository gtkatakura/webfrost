import { WebFrostError } from "@webfrost/sdk";
import type { DashboardStats, Snapshot } from "@webfrost/sdk";
import {
  Camera,
  CircleCheckBig,
  CircleX,
  Clock,
  HardDrive,
  TrendingUp,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useClient } from "../context";

// ——————————————————————————————————————————————
// Utilities
// ——————————————————————————————————————————————

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${units[i]}`;
}

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

function groupSnapshotsByDay(snapshots: Snapshot[]): Array<{ label: string; items: Snapshot[] }> {
  const groups = new Map<string, Snapshot[]>();
  for (const s of snapshots) {
    const key = new Date(s.createdAt).toDateString();
    if (!groups.has(key)) groups.set(key, []);
    // biome-ignore lint/style/noNonNullAssertion: just set above
    groups.get(key)!.push(s);
  }
  return Array.from(groups.entries()).map(([, items]) => ({
    label: dayLabel(items[0].createdAt),
    items,
  }));
}

// ——————————————————————————————————————————————
// Sub-components
// ——————————————————————————————————————————————

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse bg-gray-200 dark:bg-gray-700 rounded ${className ?? ""}`} />
  );
}

function SnapshotStatusBadge({ status }: { status: string }) {
  if (status === "done")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 shrink-0">
        <CircleCheckBig size={10} />
        done
      </span>
    );
  if (status === "failed")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 shrink-0">
        <CircleX size={10} />
        failed
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 shrink-0">
      <Clock size={10} />
      pending
    </span>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  danger,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  danger?: boolean;
  loading: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-5 flex flex-col gap-3 ${
        danger
          ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800/50"
          : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={danger ? "text-red-500" : "text-gray-400 dark:text-gray-500"}>{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
          {label}
        </span>
      </div>
      {loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-3 w-20" />
        </div>
      ) : (
        <>
          <div
            className={`text-2xl font-bold leading-none ${
              danger ? "text-red-700 dark:text-red-400" : "text-gray-900 dark:text-gray-100"
            }`}
          >
            {value}
          </div>
          {sub && (
            <div className="text-xs text-gray-500 dark:text-gray-400 leading-tight">{sub}</div>
          )}
        </>
      )}
    </div>
  );
}

// ——————————————————————————————————————————————
// Dashboard page
// ——————————————————————————————————————————————

export function DashboardPage() {
  const client = useClient();
  const navigate = useNavigate();

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsUnavailable, setStatsUnavailable] = useState(false);

  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(true);

  const [archiveUrl, setArchiveUrl] = useState("");
  const [archiving, setArchiving] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSnapshots = useCallback(async () => {
    try {
      const result = await client.listSnapshots({ limit: 30 });
      setSnapshots(result.items);
    } catch {
      // silent — partial data is fine for the dashboard
    } finally {
      setSnapshotsLoading(false);
    }
  }, [client]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await client.getStats();
      setStats(data);
      setStatsUnavailable(false);
    } catch {
      setStatsUnavailable(true);
    } finally {
      setStatsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    fetchStats();
    fetchSnapshots();
  }, [fetchStats, fetchSnapshots]);

  // Poll every 5 s while any snapshot is pending
  useEffect(() => {
    const hasPending = snapshots.some((s) => s.status === "pending");
    if (hasPending) {
      pollRef.current = setInterval(fetchSnapshots, 5000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [snapshots, fetchSnapshots]);

  async function handleArchive(e: React.FormEvent) {
    e.preventDefault();
    if (!archiveUrl.trim()) return;
    setArchiving(true);
    try {
      await client.createSnapshot(archiveUrl.trim());
      setArchiveUrl("");
      toast.success("Snapshot queued");
      await fetchSnapshots();
      await fetchStats();
    } catch (err) {
      toast.error(err instanceof WebFrostError ? err.message : String(err));
    } finally {
      setArchiving(false);
    }
  }

  const pendingSnapshots = snapshots.filter((s) => s.status === "pending");
  const completedSnapshots = snapshots.filter((s) => s.status !== "pending");
  const activityGroups = groupSnapshotsByDay(completedSnapshots);
  const isEmpty = !snapshotsLoading && snapshots.length === 0;
  const failedToday = stats?.failedToday ?? 0;

  return (
    <main className="max-w-5xl mx-auto py-8 px-4">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">Dashboard</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Overview of your WebFrost archive
        </p>
      </div>

      {/* Quick actions bar */}
      <form
        onSubmit={handleArchive}
        className="flex flex-wrap gap-2 mb-8 p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800"
      >
        <input
          type="url"
          placeholder="https://example.com — archive a URL"
          value={archiveUrl}
          onChange={(e) => setArchiveUrl(e.target.value)}
          className="flex-1 min-w-48 py-2 px-3 rounded border border-gray-300 dark:border-gray-600 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <button
          type="submit"
          disabled={archiving || !archiveUrl.trim()}
          className="py-2 px-4 rounded bg-primary text-white text-sm font-semibold border-0 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
        >
          {archiving ? "Archiving…" : "Archive"}
        </button>
        <Link
          to="/import"
          className="flex items-center gap-1.5 py-2 px-4 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium no-underline hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors shrink-0"
        >
          <Upload size={14} />
          Import
        </Link>
        <Link
          to="/snapshots"
          className="flex items-center gap-1.5 py-2 px-4 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium no-underline hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors shrink-0"
        >
          <CircleX size={14} />
          View Failures
        </Link>
      </form>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={<Camera size={16} />}
          label="Total Snapshots"
          value={stats?.snapshotCount.toLocaleString() ?? "—"}
          loading={statsLoading}
        />
        <StatCard
          icon={<HardDrive size={16} />}
          label="Storage Used"
          value={stats ? formatBytes(stats.storageBytes) : "—"}
          sub={
            stats
              ? `across ${Object.keys(stats.storageByExtractor).length} extractor(s)`
              : undefined
          }
          loading={statsLoading}
        />
        <StatCard
          icon={<TrendingUp size={16} />}
          label="Success Rate"
          value={stats ? `${stats.successRate.toFixed(1)}%` : "—"}
          sub="last 30 days"
          loading={statsLoading}
        />
        <StatCard
          icon={<TriangleAlert size={16} />}
          label="Failed Today"
          value={failedToday}
          danger={failedToday > 0}
          sub={
            failedToday > 0 ? (
              <Link
                to="/snapshots"
                className="text-red-600 dark:text-red-400 no-underline hover:underline"
              >
                View failures →
              </Link>
            ) : (
              "All good today"
            )
          }
          loading={statsLoading}
        />
      </div>

      {statsUnavailable && (
        <div className="mb-6 flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50 text-amber-700 dark:text-amber-400 text-sm">
          <TriangleAlert size={14} className="shrink-0" />
          Stats unavailable — the stats API has not been deployed yet.
        </div>
      )}

      {/* Pipeline live status */}
      {(pendingSnapshots.length > 0 || (snapshotsLoading && !isEmpty)) && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-widest mb-3">
            Pipeline
          </h2>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
            {snapshotsLoading ? (
              <div className="p-4 flex flex-col gap-4">
                {[1, 2].map((i) => (
                  <div key={i} className="flex flex-col gap-2">
                    <Skeleton className="h-4 w-2/3" />
                    <div className="flex gap-1">
                      {[1, 2, 3].map((j) => (
                        <Skeleton key={j} className="h-5 w-16" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              pendingSnapshots.map((s) => (
                <div
                  key={s.id}
                  className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 last:border-0"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Clock size={13} className="text-amber-500 shrink-0 animate-pulse" />
                    <button
                      type="button"
                      onClick={() => navigate(`/snapshots/${s.id}`)}
                      className="text-sm text-gray-700 dark:text-gray-300 truncate bg-transparent border-0 p-0 cursor-pointer hover:text-primary text-left"
                      title={s.url}
                    >
                      {s.url}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1 pl-5">
                    {s.extractors.length > 0 ? (
                      <>
                        {s.extractors.map((ext) => (
                          <span
                            key={ext}
                            className="text-xs px-2 py-0.5 rounded font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300"
                          >
                            ✓ {ext}
                          </span>
                        ))}
                        <span className="text-xs px-2 py-0.5 rounded font-medium bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500">
                          processing…
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        Extractors starting…
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* Empty state */}
      {isEmpty ? (
        <div className="text-center py-20 px-4">
          <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-4">
            <Camera size={28} className="text-gray-400 dark:text-gray-500" />
          </div>
          <p className="text-gray-700 dark:text-gray-300 font-semibold text-base mb-1">
            No snapshots yet
          </p>
          <p className="text-gray-400 dark:text-gray-500 text-sm mb-6">
            Enter a URL above to archive your first page, or import from a feed.
          </p>
          <Link
            to="/import"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors no-underline"
          >
            <Upload size={14} />
            Import from RSS / Bookmarks
          </Link>
        </div>
      ) : (
        /* Activity feed */
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-widest">
              Recent Activity
            </h2>
            <Link to="/snapshots" className="text-xs text-primary hover:underline no-underline">
              View all →
            </Link>
          </div>

          {snapshotsLoading ? (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex flex-col gap-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-3/4" />
                  <div className="flex gap-1.5">
                    <Skeleton className="h-5 w-12" />
                    <Skeleton className="h-5 w-16" />
                  </div>
                </div>
              ))}
            </div>
          ) : activityGroups.length === 0 ? (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 text-center text-sm text-gray-400 dark:text-gray-500">
              No completed snapshots yet
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
              {activityGroups.map(({ label, items }) => (
                <div key={label}>
                  <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800/50 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest border-b border-gray-100 dark:border-gray-800">
                    {label}
                  </div>
                  {items.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-start gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <button
                          type="button"
                          onClick={() => navigate(`/snapshots/${s.id}`)}
                          className="text-sm text-gray-800 dark:text-gray-200 truncate w-full text-left bg-transparent border-0 p-0 cursor-pointer hover:text-primary"
                          title={s.url}
                        >
                          {s.url}
                        </button>
                        {s.extractors.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {s.extractors.map((ext) => (
                              <span
                                key={ext}
                                className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-medium"
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
      )}
    </main>
  );
}
