// Types for images imported through a preset (see image-presets.ts).

/** `?preset=hero` or `?preset=content`: every width and format, ready for <Picture>. */
declare module "*?preset=hero" {
  const image: import("@/components/picture").ResponsiveImage;
  export default image;
}
declare module "*?preset=content" {
  const image: import("@/components/picture").ResponsiveImage;
  export default image;
}

/** `?preset=og` or `?preset=touch-icon`: the URL of one generated file. */
declare module "*?preset=og" {
  const src: string;
  export default src;
}
declare module "*?preset=touch-icon" {
  const src: string;
  export default src;
}
