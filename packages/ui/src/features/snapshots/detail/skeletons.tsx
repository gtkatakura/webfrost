import { Skeleton } from "../../../components/ui/StateViews";

/** The viewer's views, by id (see SnapshotViewerPage's tabs). */
export type ViewerTab = "page" | "reader" | "screenshot" | "media" | "raw" | "details";

const lines = (widths: number[], className = "h-2.5") =>
  widths.map((w, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
    <Skeleton key={i} className={className} style={{ width: `${w}%` }} />
  ));

/**
 * The open view while the snapshot loads, laid out like that view: the archived page and the
 * screenshot fill the panel, the reader is a column of text, files and details are the same
 * centred lists. Text lines across the whole width read as "an article", whatever comes next.
 */
export function ViewerSkeleton({ tab }: { tab: ViewerTab }) {
  const label = { role: "status", "aria-label": "Loading snapshot" } as const;
  switch (tab) {
    case "page":
      return (
        <div {...label} className="flex min-h-0 flex-1 p-3">
          <Skeleton className="size-full rounded-lg" />
        </div>
      );
    case "screenshot":
      return (
        <div {...label} className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
            <Skeleton className="size-4" />
            <Skeleton className="h-2.5 w-8" />
            <Skeleton className="size-4" />
            <Skeleton className="ml-auto h-2.5 w-16" />
          </div>
          <div className="flex min-h-0 flex-1 bg-overlay p-4">
            <Skeleton className="size-full rounded-md bg-subtle" />
          </div>
        </div>
      );
    case "reader":
      return (
        <div {...label} className="mx-auto flex w-full max-w-3xl flex-col gap-2.5 p-5">
          <Skeleton className="mb-1 h-5 w-3/5" />
          <Skeleton className="mb-3 h-2.5 w-1/4" />
          {lines([100, 96, 98, 72])}
          <div className="h-2" />
          {lines([97, 100, 88, 94, 45])}
          <div className="h-2" />
          {lines([99, 92, 60])}
        </div>
      );
    case "media":
      return (
        <div {...label} className="flex flex-col gap-4 p-5">
          <Skeleton className="mx-auto aspect-video w-full max-w-4xl rounded-lg" />
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-2.5">
            {lines([40, 25, 60])}
          </div>
        </div>
      );
    case "raw":
      return (
        <div {...label} className="mx-auto flex w-full max-w-2xl flex-col gap-2 p-5">
          {[14, 16, 10, 26, 30].map((w) => (
            <div
              key={w}
              className="flex h-[46px] items-center justify-between rounded-lg border border-border bg-overlay px-4"
            >
              <Skeleton className="h-3 bg-subtle" style={{ width: `${w}%` }} />
              <Skeleton className="size-3.5 bg-subtle" />
            </div>
          ))}
        </div>
      );
    case "details":
      return (
        <div {...label} className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-5">
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
            {[70, 12, 35, 18].map((w) => (
              <div key={w} className="flex flex-col gap-1.5">
                <Skeleton className="h-2.5 w-14" />
                <Skeleton className="h-3" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3.5 w-16" />
            <div className="overflow-hidden rounded-lg border border-border">
              {[20, 14, 24, 12].map((w) => (
                <div
                  key={w}
                  className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
                >
                  <Skeleton className="size-2 rounded-full" />
                  <Skeleton className="h-3" style={{ width: `${w}%` }} />
                  <Skeleton className="ml-auto h-2.5 w-24" />
                </div>
              ))}
            </div>
          </div>
        </div>
      );
  }
}

/** The title and address lines of the viewer's header while the snapshot loads. */
export function ViewerTitleSkeleton() {
  return (
    <span className="flex flex-col gap-1.5 py-0.5" aria-hidden="true">
      <Skeleton className="h-3 w-48 max-w-full" />
      <Skeleton className="h-2.5 w-64 max-w-full" />
    </span>
  );
}
