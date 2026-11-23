---
"@webfrost/core": patch
---

The page fetch, SingleFile's resource fetches and the bookmark and feed imports send the headers of a Chrome navigation (`User-Agent`, `Accept`, `Accept-Language`). Servers that reset the connection or answer an error to a client that does not look like a browser used to fail the snapshot, although the browser of the same run opened the page. Troubleshooting has a new section for pages that open in a browser and fail to archive, including sites under a certificate authority the runtime does not know yet (`NODE_EXTRA_CA_CERTS`).
