import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

/** How long typing rests before the draft is committed to the URL (and so sent to the server). */
export const DRAFT_COMMIT_MS = 350;

/**
 * A text field whose value lives in a URL parameter, so the request it drives is one the server
 * answers (and Back, a reload or a shared link return to the same results).
 *
 * The input shows `draft`; the URL holds `value`, the committed text. They are reconciled in one
 * direction at a time: typing commits to the URL after a pause (or at once with `immediate`),
 * and the URL only pushes into the draft when it changed from somewhere else (the back button,
 * a saved search, a link). A new value starts again from the first page.
 */
export function useDraftParam(key: string, maxLength = Number.POSITIVE_INFINITY) {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? "";
  // The setter of the latest render: one captured when typing started would rebuild the URL as it
  // was then, undoing a filter clicked or a Back pressed while the timer ran.
  const setParamsRef = useRef(setParams);
  setParamsRef.current = setParams;

  const [draft, setDraftState] = useState(value);
  const committed = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value !== committed.current) {
      // Changed from elsewhere (Back, a link): a draft still waiting to be committed is dropped.
      if (timer.current) clearTimeout(timer.current);
      committed.current = value;
      setDraftState(value);
    }
  }, [value]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function commit(text: string) {
    // Never longer than the server takes: a longer value would fail the whole request.
    const trimmed = text.trim().slice(0, maxLength);
    committed.current = trimmed;
    // The latest setter, with a functional update: the other parameters are read at commit time.
    setParamsRef.current(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (trimmed) next.set(key, trimmed);
        else next.delete(key);
        if (trimmed !== (prev.get(key) ?? "")) next.delete("page");
        return next;
      },
      { replace: true },
    );
  }

  function setDraft(text: string, immediate = false) {
    setDraftState(text);
    if (timer.current) clearTimeout(timer.current);
    if (immediate) commit(text);
    else timer.current = setTimeout(() => commit(text), DRAFT_COMMIT_MS);
  }

  return { value, draft, setDraft };
}
