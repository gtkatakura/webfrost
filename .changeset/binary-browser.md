---
"@webfrost/cli": patch
---

The `webfrost` binary archives screenshots, PDFs and SingleFile again. Built into a single file, it looked for the browser library's own files at the path of the machine that built it, so on any other machine the browser never started and only HTML, WARC and readable text were saved. `webfrost setup` and `webfrost doctor` now open a blank page to check that the browser really works (a browser can answer `--version` and still lack the libraries a page needs), and when a system library is missing they print the command that installs them with your package manager: `apt-get` (with the names Debian and Ubuntu use), `dnf` or `pacman`.
