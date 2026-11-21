"use client";
import { useEffect, useId, useState } from "react";

/** A diagram written as text. Drawn in the browser, in the page's current theme. */
export function Mermaid({ chart }: { chart: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState("");

  useEffect(() => {
    let alive = true;
    const draw = async () => {
      const { default: mermaid } = await import("mermaid");
      const dark = document.documentElement.classList.contains("dark");
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: dark ? "dark" : "neutral",
        fontFamily: "inherit",
        // Edge labels sit on the page's own ground instead of the theme's grey boxes.
        themeVariables: {
          edgeLabelBackground: getComputedStyle(document.documentElement)
            .getPropertyValue("--color-fd-background")
            .trim(),
        },
      });
      const out = await mermaid.render(`m${id}`, chart);
      if (alive) setSvg(out.svg);
    };
    void draw();
    // Draw again when the reader switches theme.
    const watch = new MutationObserver(() => void draw());
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      alive = false;
      watch.disconnect();
    };
  }, [chart, id]);

  return (
    <div
      className="my-6 overflow-x-auto [&_svg]:mx-auto"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG drawn by mermaid (securityLevel "strict") from diagram text in this repository
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
