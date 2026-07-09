---
"@harpua/agent-tools": patch
---

`fetch_url` now converts HTML with `node-html-markdown` (proper GFM tables, more robust entities) in place of the hand-rolled extractor — saved markdown uses `*` list bullets and richer table output. `fetch_pdf` reports extracted size as chars/pages (was a misleading "N lines") and gets its own 16 MB size cap, independent of `fetch_url`'s 2 MB. Added a standalone `smoke:unpdf` node script that exercises the real (ESM) unpdf extraction path jest can't. README gains an explicit table of contents.
