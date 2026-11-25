---
"@webfrost/cli": minor
"@webfrost/core": patch
"@webfrost/server": patch
---

`webfrost rescue` hardening:
- It no longer archives private addresses (localhost, the LAN, cloud metadata) from your machine just because the shell sets `WEBFROST_ALLOW_PRIVATE_URLS`: the addresses come from the server, so it takes an explicit `--allow-private`.
- Each run has a scratch archive of its own (`rescue/run-*/`), so two runs at once no longer share ids or files or remove each other's.
- Reading the text of a rendered page is a single pass: a page with a million unclosed `<template` tags can no longer hang the run.
- When a copy replaces a failure (`POST /snapshots/import?replaces=`), every other failure of exactly the same address goes to the trash in the same transaction, so a run stopped right after an upload never sends that page again.
