// Types for image imports processed by vite-imagetools (see vite.config.ts).

/** `?…&as=picture`: one srcset per format, plus the fallback <img>. */
declare module "*&as=picture" {
  const picture: {
    sources: Record<string, string>;
    img: { src: string; w: number; h: number };
  };
  export default picture;
}

/** Any other processed image: its URL (or a data: URI when it is tiny). */
declare module "*&imagetools" {
  const src: string;
  export default src;
}
