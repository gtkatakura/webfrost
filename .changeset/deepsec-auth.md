---
"@webfrost/server": patch
"@webfrost/core": patch
---

An API key that expires can no longer create a key that never expires or outlives it (`POST /settings/keys` answers `403`), so a leaked short-lived key cannot buy permanent access. A write that carries both a bearer token and the session cookie now gets the cross-origin check too, since auth falls back to the cookie when the token is not a valid key.
