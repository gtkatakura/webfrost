---
"@webfrost/core": patch
"@webfrost/server": patch
"@webfrost/ui": patch
---

Lists load a small thumbnail instead of the full-page screenshot: a WebP 640 px wide of the first screen, about 17 KB each, roughly 13 times less data on a page of cards. A long page gets a screenshot cut at 10000 px instead of none, with the extractor's whole time budget to paint it, and the card skeletons keep the layout still while the list loads.
