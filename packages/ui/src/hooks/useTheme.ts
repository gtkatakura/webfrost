import { useEffect, useState } from "react";
import { STORAGE_KEYS, readStorage, writeStorage } from "../lib/storage";

type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  const saved = readStorage(STORAGE_KEYS.theme);
  if (saved === "dark" || saved === "light") return saved;
  // The instance's default (WEBFROST_DEFAULT_THEME, written into the page by the server), then the system's.
  const preset = document.querySelector<HTMLMetaElement>(
    'meta[name="webfrost-default-theme"]',
  )?.content;
  if (preset === "dark" || preset === "light") return preset;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    writeStorage(STORAGE_KEYS.theme, theme);
  }, [theme]);

  function toggle() {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }

  return { theme, toggle };
}
