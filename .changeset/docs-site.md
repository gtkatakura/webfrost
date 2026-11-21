---
"@webfrost/sdk": patch
---

`ImportRecord.id` is typed as the string (UUID) the server actually returns, not a number.

The documentation moved from VitePress in `docs/` to a prerendered site in `apps/docs` (React Router + Vite + Fumadocs), with a landing page, search, and 27 pages rewritten against the code.
