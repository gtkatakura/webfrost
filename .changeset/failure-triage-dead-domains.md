---
"@webfrost/core": minor
"@webfrost/server": minor
"@webfrost/sdk": minor
"@webfrost/ui": minor
---

A failed snapshot now says why it failed: the archive stores a category (`domain_not_found`, `page_not_found`, `access_denied`, `rate_limited`, `timeout`, …) and the message behind it, and the API and SDK return it as `failure: { category, class, label, detail }`. A domain that no longer resolves is remembered for a week, so the next snapshots of the same domain fail at once without asking DNS again.

The new **Review failures** page in the web UI groups the failed snapshots by why (domain gone, page gone, blocked, rate limited, temporary, …), then by domain, then snapshot by snapshot, with a filter and infinite scrolling. Retry, move to trash or delete for good many at once; only failed snapshots are touched, never an earlier snapshot of the same page that worked. Deleting for good asks you to type the domain name.

Snapshots can now go to a **Trash**: hidden everywhere, restorable, and deleted for good after 30 days (a setting, 1 to 365). New routes: `GET /failures`, `GET /failures/:group/domains`, `GET /failures/:group/domains/:host/snapshots`, `POST /failures/:group/{retry,trash,delete}`, `GET /trash`, `POST /trash/{restore,delete,empty}` and `GET`/`PATCH /settings/general`. Snapshots that failed before this version are in the **Reason not recorded** group.
