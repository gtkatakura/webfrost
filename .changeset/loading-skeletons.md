---
"@webfrost/ui": patch
---

Loading placeholders now have the shape of what they stand in for, so nothing jumps when the data arrives: the viewer shows the open view (page, reader column, file list, details) and title lines instead of a few bars of text, search results and the dashboard feed have their real rows, the snapshot list rows keep their columns, and the app's frame shows while the session is checked instead of a blank screen. A view picked in the viewer before the snapshot finished loading is no longer switched back to the default one.
