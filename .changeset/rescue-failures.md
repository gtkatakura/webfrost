---
"@webfrost/cli": minor
"@webfrost/core": minor
"@webfrost/server": minor
"@webfrost/sdk": minor
"@webfrost/ui": patch
---

New `webfrost rescue <group> --from <server>`: for every failed snapshot of a group on a server (for example the pages a site refuses to the server, "Blocked by the site"), archive the page on this machine, check the copy, and send the ones that work. A copy is sent only when it is done and is the page itself, not an anti-bot interstitial or a login wall with almost no text. The server stores it and moves the failure to its trash in one step, and only while the failure is still a failure of the same URL, so running it again carries on with what is left and never stores a page twice. A domain that fails here too is given up after three tries in a row.

`POST /snapshots/import` takes `?replaces=<id>` for this (`409` when that snapshot is not, or no longer, a failure of the bundle's URL), and `GET /failures/:group/snapshots` lists a group's failed snapshots across domains; the SDK's `importSnapshot` takes `replaces` too. The failure lists answer faster on large archives.

The browser no longer installs its own Ctrl+C handler, so the server's and the CLI's graceful stop (finish what is running, then exit) is what happens on the first signal.
