---
"@webfrost/core": patch
---

Archives of real sites come out complete. The browser waits for the network to settle after the page's load event (`WEBFROST_SETTLE_MS`, 5 s at most) before the capture, so single-page apps are no longer captured half-built or on their error screen; every request still goes through the SSRF guard. SingleFile copies keep their styles and images: stylesheet and image URLs are HTML-decoded before they are fetched (`&amp;` in a query string, as on Wikipedia), an inlined stylesheet keeps its `media` query, `srcset` and `<picture>` sources that pointed back to the network are dropped, and images and icons that stylesheets point to are inlined too. PDFs print backgrounds. Videos are downloaded at up to 1080p in H.264 and AAC, which every browser plays (`WEBFROST_MEDIA_MAX_HEIGHT`), instead of the largest format available. Readable text keeps its paragraph breaks, and pages that are not articles take their title from `<title>`.
