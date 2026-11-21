import { useEffect, useState } from "react";
import { STORAGE_KEYS, readStorage, writeStorage } from "../lib/storage";

type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  const saved = readStorage(STORAGE_KEYS.theme);
  if (saved === "dark" || saved === "light") return saved;
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
