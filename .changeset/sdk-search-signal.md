---
"@webfrost/sdk": patch
---

`searchSnapshots("")` and `searchSnapshotsPage("")` return an empty result instead of the plain list typed as search results, and a result always has a `snippet` (string) and a `rank` (number). A signal passed to many requests (downloads, and failed or retried ones) no longer collects one abort listener per request. The docs no longer suggest `credentials: "include"` for cookie auth from another origin, which the server does not allow: use an API key there.
