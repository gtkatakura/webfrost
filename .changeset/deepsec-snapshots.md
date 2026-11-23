---
"@webfrost/core": patch
"@webfrost/server": patch
---

Downloads and previews are streamed instead of read whole into memory, and the `media-metadata` download only carries display fields (no yt-dlp stream URLs or headers). Deleting a snapshot that is still being archived answers `409` instead of leaving the files its pipeline writes afterwards in storage.
