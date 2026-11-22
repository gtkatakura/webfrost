---
"@webfrost/cli": patch
---

Each release also ships a `.deb` (Debian, Ubuntu) and an `.rpm` (Fedora) for x64 and arm64. They install `webfrost` in `/usr/bin` and bring, as dependencies, every system library the browser needs, so `webfrost setup` works without installing anything else; `yt-dlp` and `ffmpeg` are recommended.
