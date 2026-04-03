import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

interface ShortcutOptions {
  onToggleHelp: () => void;
}

export function useKeyboardShortcuts({ onToggleHelp }: ShortcutOptions) {
  const navigate = useNavigate();
  const seqRef = useRef("");
  const seqTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      const isEditable =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;

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
  }, [navigate, onToggleHelp]);
}

export const SHORTCUTS = [
  { keys: ["?"], description: "Show keyboard shortcuts" },
  { keys: ["g", "h"], description: "Go to home / snapshots" },
  { keys: ["g", "s"], description: "Go to snapshots" },
  { keys: ["g", "t"], description: "Go to tags" },
  { keys: ["g", "i"], description: "Go to import" },
];
