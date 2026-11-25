---
"@webfrost/core": patch
"@webfrost/server": patch
---

- Retrying a snapshot takes its old text out of the search index, so it is not found by what it said before while it is archived again, or after the new run fails.
- The trash purge and the sweep of interrupted imports check again, under the row's lock, that a snapshot is still expired or still a stale import: one restored and trashed again, or an import that finished meanwhile, is kept.
- Concurrent requests for the stats share one measuring pass instead of each asking storage about every unmeasured file.
- An uploaded bundle is removed even when the database cannot be opened to import it.
- A failure's category no longer depends on words in the hostname or URL a site redirected to.
