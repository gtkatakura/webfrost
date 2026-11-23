---
"@webfrost/core": patch
---

Feed, OPML and bookmark imports parse in linear time: a hostile feed (unclosed tags, a million links) can no longer freeze the server or the schedule worker. URL imports, `webfrost import` and RSS schedules now all hold what they fetch to `WEBFROST_IMPORT_MAX_BYTES` and `WEBFROST_IMPORT_MAX_URLS`, relative feed links resolve against the URL reached after redirects, and `webfrost schedule add` no longer reports a database error as an invalid cron expression.
