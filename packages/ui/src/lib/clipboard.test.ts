import { afterEach, describe, expect, test } from "bun:test";
import { copyText } from "./clipboard";

const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");

afterEach(() => {
  if (original) Object.defineProperty(navigator, "clipboard", original);
  else Reflect.deleteProperty(navigator, "clipboard");
});

describe("copyText", () => {
  test("uses navigator.clipboard when it exists", async () => {
    let written = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (t: string) => {
          written = t;
        },
      },
    });
    expect(await copyText("secret")).toBe(true);
    expect(written).toBe("secret");
  });

  test("falls back to execCommand on an origin without navigator.clipboard", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    let copied = "";
    const exec = document.execCommand;
    document.execCommand = ((cmd: string) => {
      const area = document.querySelector("textarea");
      copied = cmd === "copy" && area ? area.value : "";
      return true;
    }) as typeof document.execCommand;
    try {
      expect(await copyText("plain-http-key")).toBe(true);
      expect(copied).toBe("plain-http-key");
      expect(document.querySelector("textarea")).toBeNull();
    } finally {
      document.execCommand = exec;
    }
  });

  test("reports failure instead of throwing when nothing can copy", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    });
    const exec = document.execCommand;
    document.execCommand = (() => false) as typeof document.execCommand;
    try {
      expect(await copyText("x")).toBe(false);
    } finally {
      document.execCommand = exec;
    }
  });
});
