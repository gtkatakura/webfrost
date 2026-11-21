import { Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/auth";
import { useSearch } from "../hooks/useSearch";
import { Snippet } from "./Snippet";
import { Modal } from "./ui/Modal";

const MAX_RESULTS = 8;

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { canWrite } = useAuth();
  const { results: allResults, loading } = useSearch(query);
  const results = allResults.slice(0, MAX_RESULTS);
  const uid = useId().replace(/:/g, "");
  const listId = `${uid}-list`;
  const optionId = (i: number) => `${uid}-opt-${i}`;
  const trimmed = query.trim();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Reset the active option when the result set changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: allResults triggers the reset
  useEffect(() => {
    setActiveIdx(0);
  }, [allResults]);

  const open = (id: number) => {
    navigate(`/snapshots/${id}`);
    onClose();
  };
  const goToSearch = () => {
    if (!trimmed) return;
    navigate(`/search?q=${encodeURIComponent(trimmed)}`);
    onClose();
  };

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const active = results[activeIdx];
      if (active) open(active.id);
      else goToSearch();
    }
  }

  const showList = trimmed && !loading && results.length > 0;
  const hints = [
    { key: "g h", label: "Home / Dashboard" },
    { key: "g s", label: "Snapshots" },
    { key: "g t", label: "Tags" },
    ...(canWrite ? [{ key: "g i", label: "Import" }] : []),
    { key: "?", label: "Keyboard shortcuts" },
  ];

  return (
    <Modal onClose={onClose} label="Search snapshots" variant="top">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <Search size={16} className="shrink-0 text-low" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={Boolean(showList)}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? optionId(activeIdx) : undefined}
          aria-label="Search snapshots"
          placeholder="Search snapshots…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 border-0 bg-transparent text-ui-base text-high placeholder:text-low"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="flex rounded border-0 bg-transparent p-0.5 text-low hover:text-high"
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
        <kbd className="kbd">esc</kbd>
      </div>

      {trimmed && (
        <div className="max-h-[22rem] overflow-y-auto">
          <div role="status" className="empty:hidden">
            {loading && <p className="m-0 px-4 py-3 text-center text-ui-sm text-low">Searching…</p>}
            {!loading && results.length === 0 && (
              <p className="m-0 px-4 py-3 text-center text-ui-sm text-low">
                No results. Press Enter to see the full search page.
              </p>
            )}
          </div>

          {/* Options are links in spirit (they navigate) but live in a listbox so the input keeps focus. */}
          <div
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label="Results"
            hidden={!showList}
            className="m-0 list-none py-1.5 px-0"
          >
            {results.map((r, i) => (
              <div
                key={r.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === activeIdx}
                tabIndex={-1}
                onClick={() => open(r.id)}
                onKeyDown={(e) => e.key === "Enter" && open(r.id)}
                onMouseMove={() => setActiveIdx(i)}
                className={`flex flex-col gap-0.5 border-l-2 px-4 py-2 ${
                  i === activeIdx ? "border-accent bg-subtle" : "border-transparent"
                }`}
              >
                <span className="truncate text-ui-base font-medium text-high">{r.url}</span>
                {r.snippet && (
                  <span className="text-ui-sm leading-normal text-mid">
                    <Snippet text={r.snippet} />
                  </span>
                )}
              </div>
            ))}
          </div>

          {showList && (
            <button
              type="button"
              onClick={goToSearch}
              className="flex w-full items-center gap-1.5 border-0 border-t border-border bg-overlay px-4 py-2.5 text-left text-ui-sm text-mid hover:text-high"
            >
              <Search size={12} aria-hidden="true" />
              See all results for "{trimmed}"
            </button>
          )}
        </div>
      )}

      {!trimmed && (
        <div className="px-4 pt-3 pb-4">
          <div className="mb-2 text-ui-xs font-semibold tracking-wider text-low uppercase">
            Quick navigation
          </div>
          {hints.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between py-1">
              <span className="text-ui-sm text-mid">{label}</span>
              <kbd className="kbd">{key}</kbd>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
