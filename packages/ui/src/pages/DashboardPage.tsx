import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DashboardStats, Snapshot } from "@webfrost/sdk";
import { Camera, HardDrive, TrendingUp, TriangleAlert, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button, buttonClasses } from "../components/ui/Button";
import { EmptyState, ErrorState, PageHeader } from "../components/ui/StateViews";
import { UrlField } from "../components/ui/UrlField";
import { useClient } from "../context";
import { useAuth } from "../context/auth";
import {
  ActivityFeed,
  PipelineSection,
  StatCard,
  groupSnapshotsByDay,
} from "../features/dashboard/parts";
import { PENDING_POLL_MS, snapshotKeys, useCreateSnapshot } from "../hooks/useSnapshots";
import { formatBytes } from "../lib/format";
import { normalizeUrl } from "../lib/url";

const DASHBOARD_SNAPSHOT_LIMIT = 30;
const STATS_KEY = ["stats"] as const;
const DASHBOARD_SNAPSHOTS_KEY = snapshotKeys.list(1, DASHBOARD_SNAPSHOT_LIMIT);

export function DashboardPage() {
  const client = useClient();
  const queryClient = useQueryClient();
  const { canWrite } = useAuth();

  const [archiveUrl, setArchiveUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);

  const {
    data: snapshots = [],
    isPending: snapshotsLoading,
    isError: snapshotsFailed,
    error: snapshotsError,
    refetch: refetchSnapshots,
  } = useQuery({
    queryKey: DASHBOARD_SNAPSHOTS_KEY,
    queryFn: async () => (await client.listSnapshots({ limit: DASHBOARD_SNAPSHOT_LIMIT })).items,
    // Poll every 5s while any snapshot is pending
    refetchInterval: (query) =>
      (query.state.data ?? []).some((s) => s.status === "pending") ? PENDING_POLL_MS : false,
  });

  const {
    data: stats,
    isPending: statsLoading,
    isError: statsUnavailable,
    refetch: refetchStats,
  } = useQuery<DashboardStats>({
    queryKey: STATS_KEY,
    queryFn: () => client.getStats(),
    retry: false,
  });

  // Refresh stats when polling observes a snapshot leaving "pending"
  const prevPendingRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const currentPending = new Set(
      snapshots.filter((x) => x.status === "pending").map((x) => x.id),
    );
    const finished = [...prevPendingRef.current].some((id) => !currentPending.has(id));
    prevPendingRef.current = currentPending;
    if (finished) queryClient.invalidateQueries({ queryKey: STATS_KEY });
  }, [snapshots, queryClient]);

  const archive = useCreateSnapshot(() => {
    setArchiveUrl("");
    setUrlError(null);
  });

  function handleArchive(e: React.FormEvent) {
    e.preventDefault();
    if (!canWrite) return;
    const result = normalizeUrl(archiveUrl);
    if (!result.ok) {
      setUrlError(result.error);
      return;
    }
    archive.mutate(result.url);
  }

  const pending = snapshots.filter((s: Snapshot) => s.status === "pending");
  const completed = snapshots.filter((s: Snapshot) => s.status !== "pending");
  const isEmpty = !snapshotsLoading && !snapshotsFailed && snapshots.length === 0;
  const failedToday = stats?.failedToday ?? 0;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Dashboard" description="Overview of your WebFrost archive" />

      {canWrite && (
        <form
          onSubmit={handleArchive}
          noValidate
          className="mb-6 flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 sm:flex-row sm:items-start"
        >
          <UrlField
            label="Archive a URL"
            hideLabel
            placeholder="https://example.com — archive a URL"
            value={archiveUrl}
            onChange={(v) => {
              setArchiveUrl(v);
              setUrlError(null);
            }}
            error={urlError}
            size="lg"
            className="flex-1"
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              size="lg"
              disabled={archive.isPending}
              className="flex-1 sm:flex-none"
            >
              {archive.isPending ? "Archiving…" : "Archive"}
            </Button>
            <Link
              to="/import"
              className={`${buttonClasses("secondary", "lg")} flex-1 sm:flex-none`}
            >
              <Upload size={14} aria-hidden="true" />
              Import
            </Link>
          </div>
        </form>
      )}

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
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
              <Link to="/snapshots" className="font-medium text-danger">
                View failures
              </Link>
            ) : (
              "All good today"
            )
          }
          loading={statsLoading}
        />
      </div>

      {statsUnavailable && (
        <div
          role="alert"
          className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-ui-base text-warning"
        >
          <TriangleAlert size={14} className="shrink-0" aria-hidden="true" />
          Statistics are unavailable right now.
          <button
            type="button"
            onClick={() => refetchStats()}
            className="ml-auto border-0 bg-transparent p-0 text-ui-base text-warning underline"
          >
            Retry
          </button>
        </div>
      )}

      {snapshotsFailed ? (
        <ErrorState
          title="Could not load recent snapshots"
          error={snapshotsError}
          onRetry={() => refetchSnapshots()}
        />
      ) : (
        <>
          {(pending.length > 0 || (snapshotsLoading && !isEmpty)) && (
            <PipelineSection loading={snapshotsLoading} pending={pending} />
          )}

          {isEmpty ? (
            <EmptyState mascot title="No snapshots yet">
              {canWrite
                ? "Enter a URL above to archive your first page, or import from a feed."
                : "Nothing has been archived here yet."}
              {canWrite && (
                <div className="mt-5">
                  <Link to="/import" className={buttonClasses("secondary", "lg")}>
                    <Upload size={14} aria-hidden="true" />
                    Import from RSS / Bookmarks
                  </Link>
                </div>
              )}
            </EmptyState>
          ) : (
            <ActivityFeed loading={snapshotsLoading} groups={groupSnapshotsByDay(completed)} />
          )}
        </>
      )}
    </main>
  );
}
