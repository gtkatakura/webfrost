---
"@webfrost/core": patch
---

Videos are downloaded as an mp4 whenever the site offers one, so they play in the browser: archive.org, for example, lists an AVI first. When neither the video nor the audio can be downloaded, `media` fails with yt-dlp's reason instead of leaving only the metadata.
