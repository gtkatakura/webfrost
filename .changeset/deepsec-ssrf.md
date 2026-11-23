---
"@webfrost/core": patch
---

SSRF guard hardening. The HTTP fetch now connects to the address it checked (keeping the Host header and the TLS server name), so DNS rebinding can no longer swap in a private address between check and connect. IPv6 is limited to global unicast, with the IPv4 address inside IPv4-translated, 6to4 and NAT64 forms checked, and `::/96`, Teredo and local-use NAT64 refused. A 3xx other than 301/302/303/307/308 with a `Location` (a 300, or a 304) is archived as received instead of failing the snapshot. Decoding a page's `Content-Encoding` stops after three codings and 100 MB of output in all.
