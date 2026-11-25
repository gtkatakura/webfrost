---
"@webfrost/core": minor
"@webfrost/server": minor
"@webfrost/sdk": minor
"@webfrost/ui": minor
---

A failed snapshot now says why it failed: the archive stores a category (`domain_not_found`, `page_not_found`, `access_denied`, `rate_limited`, `timeout`, …) and the message behind it, and the API and SDK return it as `failure: { category, class, label, detail }`. A domain that no longer resolves is remembered for ten minutes, so the other pages of a dead site in the same import fail at once without asking DNS again.

The new **Review failures** page in the web UI groups the failed snapshots by why (domain gone, page gone, blocked, rate limited, temporary, …), then by domain, then snapshot by snapshot, with a filter and infinite scrolling. Retry, move to trash or delete for good many at once; only failed snapshots are touched, never an earlier snapshot of the same page that worked. Deleting for good asks you to type the domain name.

Snapshots can now go to a **Trash**: hidden from every list, search and count (and from anonymous visitors of a public-read server by their address too), restorable, and deleted for good after 30 days (a setting, 1 to 365). A trashed snapshot still counts as a known URL for feed schedules, so a feed does not archive it again. New routes: `GET /failures`, `GET /failures/:group/domains`, `GET /failures/:group/domains/:host/snapshots`, `POST /failures/:group/{retry,trash,delete}`, `GET /trash`, `POST /trash/{restore,delete,empty}` and `GET`/`PATCH /settings/general`. Snapshots that failed before this version are in the **Reason not recorded** group.

In traces, `error.type` on the `snapshot.archive` span is now that failure category (`page_not_found`, `network_error`, …) instead of `fetch_network` or `fetch_http_status`: update alerts that match the old values.
