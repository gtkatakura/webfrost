import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Copies text. navigator.clipboard only exists in secure contexts (HTTPS, localhost), so on a
 * plain-HTTP self-hosted origin it is undefined: fall back to execCommand("copy") on a hidden
 * textarea. Resolves to whether the text was copied.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or insecure context: use the fallback below.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export type CopyState = "idle" | "copied" | "failed";

/**
 * Copy with feedback. When copying is impossible the optional element is selected so the user
 * can press Ctrl/Cmd+C themselves, and the state becomes "failed" to say so.
 */
export function useCopy(resetMs = 2500) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (text: string, selectOnFail?: HTMLInputElement | HTMLTextAreaElement | null) => {
      const ok = await copyText(text);
      if (!ok) selectOnFail?.select();
      setState(ok ? "copied" : "failed");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState("idle"), resetMs);
      return ok;
    },
    [resetMs],
  );

  return { state, copy };
}
