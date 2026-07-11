---
"@harpua/agent-tools": patch
---

`search_files` no longer reports `"No matches."` when a glob matched no files. ripgrep exits `1` both when it searched and found nothing *and* when the glob excluded every file — so the tool was telling agents a pattern was absent from files it had never opened. When a glob is supplied and the search comes back empty, `search_files` now checks whether the glob matched any file at all, and if it didn't, says so explicitly: nothing was searched, and this is not evidence the pattern is absent. Searches without a glob, and searches whose glob matched real files, are unchanged (no extra ripgrep process on any path that wasn't already a dead end).
