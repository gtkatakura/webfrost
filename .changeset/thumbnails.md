---
"@webfrost/core": patch
"@webfrost/server": patch
"@webfrost/ui": patch
---

Lists load a small thumbnail instead of the full-page screenshot: about 13 times less data on a page of cards. A long page gets a screenshot cut at 16000 px instead of none, and the card skeletons keep the layout still while the list loads.
