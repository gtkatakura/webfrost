import shareImage from "@/assets/brand/share.webp?preset=og";

/** Where the site is published. Used for absolute URLs (social share image, canonical links). */
export const siteUrl = "https://webfrost.dev";

type MetaTag = { name: string; content: string } | { property: string; content: string };

/** Open Graph and Twitter tags, so a link pasted in a chat or social site shows a card. */
export function shareMeta(page: { title: string; description: string; path: string }): MetaTag[] {
  return [
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "WebFrost" },
    { property: "og:url", content: `${siteUrl}${page.path}` },
    { property: "og:title", content: page.title },
    { property: "og:description", content: page.description },
    { property: "og:image", content: `${siteUrl}${shareImage}` },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    {
      property: "og:image:alt",
      content: "The WebFrost mascot, an arctic fox on a frozen archive box",
    },
    { name: "twitter:card", content: "summary_large_image" },
  ];
}
