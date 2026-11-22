import { Bookmark, BookmarkCheck, X } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { MAX_SAVED, type SavedSearch, loadSaved, persistSaved } from "./savedSearchStore";

/** Save button, naming input and the chips of saved searches. Owns the saved list. */
export function SavedSearches({
  query,
  onApply,
}: {
  /** The query currently in the URL (empty when nothing is searched). */
  query: string;
  onApply: (q: string) => void;
}) {
  const [saved, setSaved] = useState<SavedSearch[]>(loadSaved);
  const [naming, setNaming] = useState(false);
  const [nameInput, setNameInput] = useState("");

  const isSaved = saved.some((s) => s.q === query);

  function update(next: SavedSearch[]) {
    setSaved(next);
    persistSaved(next);
  }

  function toggleSave() {
    if (!query) return;
    if (isSaved) {
      update(saved.filter((s) => s.q !== query));
      return;
    }
    setNameInput(query);
    setNaming(true);
  }

  function confirmSave() {
    const name = nameInput.trim() || query;
    update([{ name, q: query }, ...saved.filter((s) => s.q !== query)].slice(0, MAX_SAVED));
    setNaming(false);
  }

  return (
    <>
      {query && (
        <button
          type="button"
          onClick={toggleSave}
          aria-pressed={isSaved}
          title={isSaved ? "Remove saved search" : "Save this search"}
          className={`flex h-10 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 text-ui-sm font-medium transition-colors hover:border-border-strong ${
            isSaved ? "bg-accent/10 text-accent-text" : "bg-surface text-mid hover:text-high"
          }`}
        >
          {isSaved ? (
            <BookmarkCheck size={14} aria-hidden="true" />
          ) : (
            <Bookmark size={14} aria-hidden="true" />
          )}
          {isSaved ? "Saved" : "Save"}
        </button>
      )}

      {naming && (
        <div className="order-last mt-3 flex basis-full items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5">
          <input
            type="text"
            aria-label="Name this search"
            placeholder="Name this search…"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmSave();
              if (e.key === "Escape") setNaming(false);
            }}
            className="field flex-1"
            // biome-ignore lint/a11y/noAutofocus: the user just asked to name the search
            autoFocus
          />
          <Button size="sm" onClick={confirmSave}>
            Save
          </Button>
          <button
            type="button"
            onClick={() => setNaming(false)}
            aria-label="Cancel"
            className="flex rounded border-0 bg-transparent p-1 text-low hover:text-high"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      {saved.length > 0 && (
        <ul
          aria-label="Saved searches"
          className="order-last m-0 mt-3 flex basis-full list-none flex-wrap gap-1.5 p-0"
        >
          {saved.map((s) => (
            <li
              key={s.q}
              className={`inline-flex h-7 items-center gap-0.5 rounded-full border pl-2.5 pr-0.5 text-ui-sm font-medium ${
                s.q === query
                  ? "border-accent/40 bg-accent/10 text-accent-text"
                  : "border-border bg-surface text-mid"
              }`}
            >
              <button
                type="button"
                onClick={() => onApply(s.q)}
                className="border-0 bg-transparent p-0 text-inherit hover:underline"
              >
                {s.name}
              </button>
              <button
                type="button"
                onClick={() => update(saved.filter((x) => x.q !== s.q))}
                aria-label={`Remove saved search ${s.name}`}
                className="flex size-6 items-center justify-center rounded-full border-0 bg-transparent p-0 text-low hover:bg-danger/10 hover:text-danger"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
