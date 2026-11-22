---
"@webfrost/core": minor
"@webfrost/server": minor
"@webfrost/sdk": minor
"@webfrost/ui": minor
---

A snapshot can be archived again in place. The snapshot's Details view has an **Archive again** button, the API has `POST /snapshots/:id/retry` (rate limited like snapshot creation, `409` while the snapshot is still being archived) and the SDK has `retrySnapshot(id)`. The snapshot keeps its id, address and color scheme, and every format is replaced by the new run: useful for a page that changed or a video a site refused the first time.
