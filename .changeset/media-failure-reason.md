---
"@webfrost/core": patch
---

When a video site refuses a video (private, removed, or asking to confirm the visitor is not a bot, as YouTube often does to server addresses), the `media` extractor now fails with yt-dlp's reason, shown in the snapshot's details, instead of being skipped without a word. Pages on sites yt-dlp does not support are still skipped silently.
