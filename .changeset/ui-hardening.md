---
"@webfrost/ui": patch
"@webfrost/server": patch
"@webfrost/sdk": patch
---

- The `webfrost login` and `webfrost rescue` commands the web UI offers to copy carry the server's origin only: a link with shell syntax in its path can no longer put it into a command someone pastes.
- Typing in a filter or search box no longer undoes a filter clicked, or a Back pressed, while the text waited to be sent.
- The snapshot filter takes at most the 200 characters the server accepts, instead of failing the whole list.
- A search page past the end steps back to the last page, as the snapshot list does.
- "Select all" on a failure group ends when the list's totals change, so a confirmation never shows fewer snapshots than will be acted on.
- `POST /failures/:group/trash` answers with the `ids` it moved, and Undo restores exactly those (one already in the trash stays there).
