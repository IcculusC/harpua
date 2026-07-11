---
"@harpua/agent-tools": patch
---

`search_files` no longer reports `"No matches."` when it searched nothing at all. ripgrep exits `1` both when it searched files and found nothing *and* when it searched no files whatsoever — because a glob matched none, because ignore rules excluded them all, or because the tree is empty. The tool collapsed those into one string, telling agents a pattern was absent from files it had never opened.

An empty search now establishes *why* it was empty before answering, and says so:

- **Files were searched** → `"No matches."`, unchanged and true.
- **The glob matched no files** → says nothing was searched, that this is not evidence the pattern is absent, and notes that a bare directory name (`src`) matches nothing where `src/**` works.
- **The matching files are excluded by ignore rules** → names ignore rules as the cause rather than blaming the glob, and does *not* suggest broadening the search, which would silently skip those files and hand back a confident partial answer.
- **The probe itself fails** → falls back to `"No matches."` rather than inventing a cause.

The diagnosis costs at most two extra `rg --files --quiet` probes, which print nothing and exit at the first file found, and only ever run on a search that already came back empty.
