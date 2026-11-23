---
"@webfrost/core": patch
"@webfrost/cli": patch
"@webfrost/server": patch
---

The archiving browser now sends every connection through an SSRF egress proxy that checks the address it connects to. Shared and dedicated workers (including their WebSockets) and redirect hops can no longer reach internal hosts, and the browser is no longer open to DNS rebinding. The scroll pass is also capped at 15 seconds, so a page that replaces its own timers can no longer hang a snapshot.
