---
"@webfrost/core": minor
"@webfrost/server": minor
"@webfrost/sdk": minor
"@webfrost/ui": minor
---

Filters look at the whole archive. In the web UI, **Filter by URL or title** on Snapshots and the status, date, extractor and tag filters on Search used to narrow only the 20 rows already on the page, so a snapshot on another page was never found. They are now answered by the database: the list, the count and the pages are of what matches in the archive, and the filter is kept in the address.

`GET /snapshots` takes `since`, `before`, `extractor`, `tag` and `contains` (text in the URL or the title), and `status` takes several values; they work on the list and on a search (`q`). A value that cannot be read answers `400`. The SDK's `listSnapshots`, `iterateSnapshots` and `searchSnapshotsPage` take the same filters (`status`, `since`, `before`, `extractors`, `tags`, `contains`).
