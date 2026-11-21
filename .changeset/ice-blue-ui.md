---
"@webfrost/ui": minor
---

The web UI gets the WebFrost look and a round of fixes.

- **Ice Blue brand.** The design tokens now match the docs site (light and dark), with the hexagon mark and the "Web**Frost**" wordmark in the sidebar, the mobile header, and the login and setup pages, and the arctic fox on the login, setup and empty-archive screens. Text colors meet WCAG AA contrast.
- **Errors are no longer silent.** A failed query on the snapshot list, dashboard, schedules, API keys, tags or import history shows an error with Retry instead of "No snapshots yet". Creating or deleting a tag reports failures. When the server cannot be reached the app says "Can't reach the WebFrost server" with Retry instead of showing the login form. Copying the one-time API key works on plain-HTTP origins, or selects the key so you can copy it yourself.
- **Safer bulk actions.** Selections no longer survive a page or filter change, so bulk delete only touches rows you can see, and the confirmation says exactly how many snapshots will be deleted.
- **One detail view.** `/snapshots/:id` opens the slide-over panel over the list (the standalone detail page is gone; `?detail=` still works). The panel keeps your tab while a pending snapshot refreshes, and a malformed id opens nothing.
- **Forgiving URL fields.** "example.com" is accepted and archived as `https://example.com/`, with an inline message for anything that is not a web address.
- **Also fixed:** the Search page no longer overwrites what you are typing, the list page number is kept in the URL and clamped after deletes.
- **Accessibility.** One dialog component (focus trap, Escape, focus restore) for the command palette, the shortcuts help and the detail panel; listbox semantics in the palette; tabs with arrow-key navigation; a shared focus ring; labelled icon buttons; reduced-motion support.
- **Phone layout.** The snapshot list wraps and drops secondary columns, the detail panel is full width with the metadata below the content, and the mobile menu is a single drawer that is inert when closed and closes with Escape.
- **Code health.** The largest pages are split into feature folders, dead components and duplicated parsers are gone, and error messages, local-storage keys and the delete mutation each live in one place.
