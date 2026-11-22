---
"@webfrost/core": patch
---

Long pages get their screenshot in about half a second instead of timing out: a page taller than the 10000 px limit is shot through a viewport that tall, so Chromium paints only what is kept instead of the whole page.
