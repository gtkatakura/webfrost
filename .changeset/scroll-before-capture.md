---
"@webfrost/core": patch
---

Pages that reveal their sections as you scroll, or load images only near the viewport, are archived whole: the browser scrolls through the page once (up to 20000 px, a few seconds) before the captures. SingleFile copies also inline the images that a page's own `<style>` blocks and `style` attributes point to, such as logos drawn with a CSS mask. On bun.sh both used to leave everything below the first screen blank.
