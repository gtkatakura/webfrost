---
"@webfrost/core": patch
"@webfrost/cli": patch
"@webfrost/server": patch
"@webfrost/sdk": patch
"@webfrost/ui": patch
---

Tags: one name rule everywhere. Names in any script keep their letters in the slug (`日本語`, `ação` and `aço` are separate tags instead of colliding on an empty or lossy slug), names are trimmed, and a name without a letter or digit is refused with 400. Bundle export only writes tag names the importer accepts. `webfrost tag add` finds an existing tag by slug instead of failing on a UNIQUE error. Concurrent bundle imports with the same new tag no longer fail, tag changes on a snapshot are serialised so the search index keeps up, and an interrupted bundle import is detected by its heartbeat and always leaves no files behind.
