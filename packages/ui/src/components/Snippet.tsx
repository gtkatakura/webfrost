import type { ReactNode } from "react";

const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
};

/** Decode the entities the server emits, in a single pass (so `&amp;lt;` becomes `&lt;`). */
export function decodeEntities(text: string): string {
  return text.replace(/&(?:lt|gt|amp|quot|#39);/g, (m) => ENTITIES[m] ?? m);
}

/**
 * Renders a server search snippet. Only literal `<mark>`/`</mark>` are treated
 * as markup; everything else is rendered as text (never as HTML).
 */
export function Snippet({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(<\/?mark>)/);
  const nodes: ReactNode[] = [];
  let inMark = false;
  let offset = 0;
  for (const part of parts) {
    const key = offset;
    offset += part.length;
    if (part === "<mark>") {
      inMark = true;
    } else if (part === "</mark>") {
      inMark = false;
    } else if (part) {
      const decoded = decodeEntities(part);
      nodes.push(inMark ? <mark key={key}>{decoded}</mark> : decoded);
    }
  }
  return <span className={className}>{nodes}</span>;
}
