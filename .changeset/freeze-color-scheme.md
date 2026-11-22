---
"@webfrost/core": patch
"@webfrost/ui": patch
---

An archived page keeps the theme it was archived in. Its stylesheets hold both themes behind `prefers-color-scheme`, which the browser answers with the viewer's system setting, so a page archived dark showed light on a light system. The SingleFile copy now fixes those conditions to the archived scheme.
