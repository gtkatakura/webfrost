---
"@webfrost/core": patch
"@webfrost/server": patch
"@webfrost/cli": patch
---

- MySQL: a schema step interrupted after adding a column or an index runs again instead of failing every later start.
- The server routes a request by the same path its request guard, auth check and rate limiters read (a short `Host` could make them see a different one), and refuses JSON bodies over 1 MiB before reading them, except on `POST /import`.
- The `webfrost` binary no longer reads `.env` or `bunfig.toml` from the folder it is run in.
- A `--headers-command` that leaves a process running no longer hangs the command line, and its timeout ends everything it started.
- Pending `webfrost login` requests are counted per IPv6 /48, and a full store takes room from the client with the most of them.
- Pages nested deeper than 512 elements, or with more than 100,000, are not handed to Readability, whose cost grows with the square of the depth.
