import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

interface ShortcutOptions {
  onToggleHelp: () => void;
  onOpenSearch?: () => void;
  onToggleSidebar?: () => void;
  /** Guests cannot reach write-only pages, so their shortcuts are not bound. */
  canWrite?: boolean;
}

export function useKeyboardShortcuts({
  onToggleHelp,
  onOpenSearch,
  onToggleSidebar,
  canWrite = true,
}: ShortcutOptions) {
  const navigate = useNavigate();
  const seqRef = useRef("");
  const seqTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      const isEditable =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;

      // Cmd+K / Ctrl+K = open search palette
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenSearch?.();
        return;
      }

      // Cmd+B / Ctrl+B = show or hide the sidebar (also from inside a field, like in editors)
      if (e.key === "b" && (e.metaKey || e.ctrlKey) && !e.altKey && !target.isContentEditable) {
        e.preventDefault();
        onToggleSidebar?.();
        return;
      }

      // "/" = focus this page's own search field; pages without one open the palette
      if (e.key === "/" && !isEditable && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const field = document.querySelector<HTMLInputElement>("[data-page-search]");
        if (field) {
          field.focus();
          field.select();
        } else {
          onOpenSearch?.();
        }
        return;
      }

      // "?" = show shortcuts help (only outside inputs)
      if (e.key === "?" && !isEditable && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onToggleHelp();
        return;
      }

      // "g X" sequences for navigation (outside inputs)
      if (!isEditable && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (seqRef.current === "g") {
          if (seqTimerRef.current) clearTimeout(seqTimerRef.current);
          seqRef.current = "";
          switch (e.key) {
            case "h":
              e.preventDefault();
              navigate("/");
              break;
            case "s":
              e.preventDefault();
              navigate("/snapshots");
              break;
            case "t":
              e.preventDefault();
              navigate("/tags");
              break;
            case "i":
              if (!canWrite) break;
              e.preventDefault();
              navigate("/import");
              break;
          }
          return;
        }

        if (e.key === "g") {
          seqRef.current = "g";
          seqTimerRef.current = setTimeout(() => {
            seqRef.current = "";
          }, 1000);
          return;
        }

        seqRef.current = "";
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (seqTimerRef.current) clearTimeout(seqTimerRef.current);
    };
  }, [navigate, onToggleHelp, onOpenSearch, onToggleSidebar, canWrite]);
}

export const SHORTCUTS = [
  { keys: ["⌘", "K"], description: "Open search palette" },
  { keys: ["/"], description: "Search or filter on this page" },
  { keys: ["⌘", "B"], description: "Show or hide the sidebar" },
  { keys: ["?"], description: "Show keyboard shortcuts" },
  { keys: ["g", "h"], description: "Go to home / dashboard" },
  { keys: ["g", "s"], description: "Go to snapshots" },
  { keys: ["g", "t"], description: "Go to tags" },
  { keys: ["g", "i"], description: "Go to import" },
  { keys: ["F"], description: "Snapshot: show the page full screen" },
  { keys: ["I"], description: "Snapshot: show or hide the details" },
  { keys: ["Esc"], description: "Snapshot: back to the list" },
];

/** Shortcuts shown in the help modal; "go to import" is hidden for read-only guests. */
export function shortcutsFor(canWrite: boolean) {
  return canWrite ? SHORTCUTS : SHORTCUTS.filter((s) => s.keys.join("") !== "gi");
}
