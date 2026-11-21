import { ChevronDown, Plus, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button, buttonClasses } from "../../components/ui/Button";
import { UrlField } from "../../components/ui/UrlField";
import { normalizeUrl } from "../../lib/url";

/** Header button that opens a small popover with a URL field and a link to Import. */
export function NewSnapshotMenu({
  onArchiveUrl,
  submitting,
}: {
  onArchiveUrl: (url: string) => void;
  submitting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Escape closes the popover and hands focus back to its button; so does a click outside.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onPointer(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = normalizeUrl(url);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onArchiveUrl(result.url);
    setUrl("");
    setError(null);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={buttonClasses("primary", "md")}
      >
        <Plus size={14} aria-hidden="true" />
        New Snapshot
        <ChevronDown size={12} className="opacity-70" aria-hidden="true" />
      </button>

      {open && (
        // Below sm the popover is pinned to the page gutters so it can never leave the screen.
        <div
          role="dialog"
          aria-label="Archive a URL"
          className="animate-pop-in fixed inset-x-4 z-20 mt-1 rounded-lg border border-border bg-surface p-3 shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:w-[22rem]"
        >
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-2">
            <UrlField
              label="Archive a URL"
              value={url}
              onChange={(v) => {
                setUrl(v);
                setError(null);
              }}
              error={error}
              autoFocus
            />
            <Button type="submit" disabled={submitting}>
              {submitting ? "Queuing…" : "Archive"}
            </Button>
          </form>
          <div className="mt-2 border-t border-border pt-2">
            <Link
              to="/import"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-ui-sm text-mid no-underline transition-colors hover:bg-subtle hover:text-high hover:no-underline"
            >
              <Upload size={13} aria-hidden="true" />
              Import from RSS / Bookmarks
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
