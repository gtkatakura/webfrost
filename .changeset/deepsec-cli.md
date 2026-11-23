---
"@webfrost/core": patch
"@webfrost/cli": patch
---

The CLI strips control characters (escape sequences included) from archived text, URLs and tag names before printing them. `webfrost doctor` no longer deletes a data directory it did not create (a symlink to an unmounted drive, for example). The concurrency limiter hands a freed slot straight to the next waiter, so the limit cannot be exceeded.
