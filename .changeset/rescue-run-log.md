---
"@webfrost/cli": minor
"@webfrost/core": patch
---

`webfrost rescue` logs every run in `logs/` of the data directory (`rescue-<start time>.jsonl`): one JSON line per page as it is done, with its address, the outcome and the reason (and the server's new snapshot when rescued), then the summary. The record survives a closed terminal, Ctrl+C or a crash; `--no-log` skips it. The upload progress line no longer overwrites the pages' lines, and archiving no longer prints "Could not parse CSS stylesheet" for each stylesheet it cannot read.
