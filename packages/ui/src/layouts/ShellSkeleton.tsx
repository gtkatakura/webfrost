import { Logo } from "../components/Logo";
import { Skeleton } from "../components/ui/StateViews";
import { STORAGE_KEYS, readStorage } from "../lib/storage";

/**
 * The app's frame while the first request (is there a session?) is out: the mobile top bar, or the
 * sidebar at the width it will have, so the page does not start from an empty screen and then jump.
 * Only the frame: what goes inside is the page's own business once it renders.
 */
export function ShellSkeleton() {
  const compact = readStorage(STORAGE_KEYS.sidebarCollapsed) === "true";
  return (
    <div className="flex min-h-dvh bg-app" role="status" aria-label="Loading">
      <header className="fixed inset-x-0 top-0 z-40 flex h-12 items-center border-b border-border bg-surface pl-4 lg:hidden">
        <Logo size={22} className="text-base" />
      </header>
      <aside
        className={`hidden h-dvh shrink-0 flex-col gap-3 border-r border-border bg-surface px-3 py-3.5 lg:sticky lg:top-0 lg:flex ${
          compact ? "w-14 items-center px-2" : "w-60"
        }`}
      >
        <Skeleton className={compact ? "size-6" : "h-5 w-28"} />
        <Skeleton className={`mt-2 h-8 ${compact ? "w-8" : "w-full"}`} />
        <div className="mt-3 flex flex-col gap-3">
          {[20, 24, 14].map((w) => (
            <div key={w} className="flex items-center gap-3 px-1.5">
              <Skeleton className="size-4 shrink-0" />
              {!compact && <Skeleton className="h-2.5" style={{ width: `${w * 4}px` }} />}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
