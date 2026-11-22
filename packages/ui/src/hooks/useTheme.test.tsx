import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import { useTheme } from "./useTheme";

function setDefaultTheme(content: string) {
  const meta = document.createElement("meta");
  meta.name = "webfrost-default-theme";
  meta.content = content;
  document.head.appendChild(meta);
}

beforeEach(() => {
  localStorage.removeItem("webfrost-theme");
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  cleanup();
  for (const m of document.head.querySelectorAll('meta[name="webfrost-default-theme"]')) m.remove();
  localStorage.removeItem("webfrost-theme");
  document.documentElement.classList.remove("dark");
});

describe("useTheme — initial theme", () => {
  test("the instance default (meta tag) applies when nothing is saved", () => {
    setDefaultTheme("dark");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  test("a saved choice wins over the instance default", () => {
    setDefaultTheme("dark");
    localStorage.setItem("webfrost-theme", "light");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  test("an invalid default is ignored", () => {
    setDefaultTheme("purple");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
  });
});
