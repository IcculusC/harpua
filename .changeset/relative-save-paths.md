---
"@harpua/agent-tools": patch
---

fetch_url / fetch_pdf confirmations name the saved file as the file-exploration tools address it (bare filename, "as x.md") instead of a cwd-relative path ("to sources/x.md"). Models echo the confirmation verbatim into read_lines/search_files, which are jailed to the same directory — the old wording double-resolved ("sources/sources/x.md") and every follow-up read failed. Observed live in the notebook consumer app.
