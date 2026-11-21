import type { Plugin } from "vite";

/**
 * Named recipes for vite-imagetools, so a page imports an image once:
 *
 *   import mascot from "@/assets/brand/mascot.webp?preset=hero";
 *   <Picture image={mascot} sizes="…" alt="…" />
 *
 * A preset expands into several imagetools imports (AVIF and WebP need different quality settings to
 * look the same, and art direction needs a second crop) and merges them into one `ResponsiveImage`.
 */

// AVIF reaches the look of WebP q80 at a much lower setting, at about half the bytes.
const AVIF = "format=avif&quality=55";
const WEBP_JPG = "format=webp;jpg&quality=80";
const BLUR = "w=24&format=webp&quality=50";

interface Recipe {
  /** Query for the main picture, without the format part. */
  wide: string;
  /** A second crop for phones, used below 640 px. */
  narrow?: string;
  /** Add a tiny blurred placeholder. */
  blur?: boolean;
}

const pictures: Record<string, Recipe> = {
  /** The big image at the top of a page, with a 4:3 crop for phones. */
  hero: {
    wide: "w=560;840;1120;1600",
    narrow: "w=400;640;960&aspect=4:3&fit=cover&position=center",
    blur: true,
  },
  /** An image inside the text column, such as a screenshot of the UI. */
  content: { wide: "w=480;720;960;1440;1920", blur: true },
};

/** Single files, imported as a URL. */
const files: Record<string, string> = {
  /** Link preview for social sites and chat apps (Open Graph, 1200×630). */
  og: "w=1200&h=630&fit=cover&format=jpg&quality=85",
  /** Home-screen icon for iOS. Flattened: iOS shows transparent corners as black. */
  "touch-icon": "w=180&h=180&format=png&flatten&background=%23080c16",
};

export const presetNames = [...Object.keys(pictures), ...Object.keys(files)];

const PREFIX = "\0image-preset:";

function pictureModule(file: string, recipe: Recipe): string {
  const src = (query: string) => JSON.stringify(`${file}?${query}&as=picture`);
  const lines = [
    `import wideAvif from ${src(`${recipe.wide}&${AVIF}`)};`,
    `import wideRest from ${src(`${recipe.wide}&${WEBP_JPG}`)};`,
    "const merge = (a, b) => ({ sources: { ...a.sources, ...b.sources }, img: b.img });",
  ];
  let narrow = "undefined";
  if (recipe.narrow) {
    lines.push(
      `import narrowAvif from ${src(`${recipe.narrow}&${AVIF}`)};`,
      `import narrowRest from ${src(`${recipe.narrow}&${WEBP_JPG}`)};`,
    );
    narrow = "merge(narrowAvif, narrowRest)";
  }
  let placeholder = "undefined";
  if (recipe.blur) {
    lines.push(`import blur from ${JSON.stringify(`${file}?${BLUR}`)};`);
    placeholder = "blur";
  }
  lines.push(
    `export default { picture: merge(wideAvif, wideRest), narrow: ${narrow}, placeholder: ${placeholder} };`,
  );
  return lines.join("\n");
}

export function imagePresets(): Plugin {
  return {
    name: "webfrost:image-presets",
    enforce: "pre",
    async resolveId(id, importer) {
      const [path, query] = id.split("?");
      const preset = new URLSearchParams(query ?? "").get("preset");
      if (!path || !preset) return null;
      if (!presetNames.includes(preset)) {
        this.error(`unknown image preset "${preset}" in ${id}; known: ${presetNames.join(", ")}`);
      }
      const resolved = await this.resolve(path, importer, { skipSelf: true });
      if (!resolved) this.error(`image not found: ${path} (imported from ${importer})`);
      return `${PREFIX}${preset}:${resolved.id}`;
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return null;
      const rest = id.slice(PREFIX.length);
      const colon = rest.indexOf(":");
      const preset = rest.slice(0, colon);
      const file = rest.slice(colon + 1);
      const recipe = pictures[preset];
      if (recipe) return pictureModule(file, recipe);
      return `export { default } from ${JSON.stringify(`${file}?${files[preset]}`)};`;
    },
  };
}
