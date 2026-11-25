---
"@webfrost/core": patch
---

A run whose job was taken over by another worker (it stalled, and was presumed dead) can no longer overwrite the files of the run that took over. Each run writes its files in a folder of its own (`<snapshot>/.stage-<lease>/`) and moves each into place only while it still holds the job's lease; what it never moved is removed when it ends. `StorageBackend` gains an optional `stage` on `localPath`/`finalize` and `discardStage`.
