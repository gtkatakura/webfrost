---
"@webfrost/server": patch
---

With `AUTH_DISABLED=true` (local development) the API answers only requests whose `Host` is `localhost`, a `127.x` address or `[::1]`, so a web page cannot reach a local instance by re-pointing its own name at your machine (DNS rebinding). `WEBFROST_ALLOWED_HOSTS` adds names for a dev server reached by another one.
