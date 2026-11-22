import { Picture, type ResponsiveImage } from "./picture";

/** Drawn at most this wide in the text column. */
const SIZES = "(min-width: 1280px) 768px, (min-width: 768px) 70vw, 100vw";

/**
 * A screenshot of the web UI in both themes: CSS shows the one matching the site's `dark` class, so it
 * follows the theme toggle, and the hidden one is never downloaded (Picture loads lazily). Import both
 * with `?preset=content`.
 */
export function Screenshot({
  light,
  dark,
  alt,
  caption,
}: {
  light: ResponsiveImage;
  dark: ResponsiveImage;
  alt: string;
  caption?: string;
}) {
  const frame = "rounded-xl border border-fd-border shadow-sm";
  return (
    <figure className="not-prose my-6">
      <Picture image={light} sizes={SIZES} alt={alt} className={`${frame} dark:hidden`} />
      <Picture image={dark} sizes={SIZES} alt={alt} className={`${frame} hidden dark:block`} />
      {caption ? (
        <figcaption className="mt-2 text-sm text-fd-muted-foreground">{caption}</figcaption>
      ) : null}
    </figure>
  );
}
