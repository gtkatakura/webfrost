import { docsRoute } from "@/lib/shared";
import type { ComponentProps, FocusEvent, MouseEvent } from "react";
import { Link } from "react-router";

/**
 * Warm the page's MDX module, which the docs route imports only while rendering. Together with the
 * route data that React Router prefetches, a click then has nothing left to wait for.
 */
async function preloadDoc(href: string): Promise<void> {
  if (!href.startsWith(docsRoute)) return;
  const slug =
    href
      .slice(docsRoute.length)
      .split("#")[0]
      ?.replace(/^\/+|\/+$/g, "") ?? "";
  const { docs } = await import("@/lib/source");
  for (const path of slug ? [`${slug}.mdx`, `${slug}/index.mdx`] : ["index.mdx"]) {
    const page = docs.getPage(path);
    if (page) {
      await page.load();
      return;
    }
  }
}

/**
 * The link Fumadocs renders everywhere (sidebar, cards, prev/next). Internal links prefetch on hover
 * or focus, like next/link; external ones stay plain anchors.
 */
export function PrefetchLink({
  href = "",
  prefetch: _prefetch,
  onMouseEnter,
  onFocus,
  ...props
}: ComponentProps<"a"> & { prefetch?: boolean }) {
  if (!href.startsWith("/")) return <a href={href} {...props} />;
  const warm = () => void preloadDoc(href).catch(() => {});
  return (
    <Link
      to={href}
      prefetch="intent"
      onMouseEnter={(e: MouseEvent<HTMLAnchorElement>) => {
        warm();
        onMouseEnter?.(e);
      }}
      onFocus={(e: FocusEvent<HTMLAnchorElement>) => {
        warm();
        onFocus?.(e);
      }}
      {...props}
    />
  );
}
