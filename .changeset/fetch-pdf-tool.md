---
"@harpua/agent-tools": patch
---

Add `fetchPdfTool` (`fetch_pdf`): an opt-in tool that fetches a PDF by URL, extracts its text with [`unpdf`](https://github.com/unjs/unpdf), and saves it to `saveDir` as frontmattered markdown — the same fetch → save → explore loop as `fetch_url`, so a fetched PDF becomes searchable by `fileExplorationTools`.

`unpdf` is an **optional peer dependency** (`pnpm add unpdf`); if it isn't installed the tool returns an install hint instead of throwing. `fetch_pdf` is exported on its own and is **not** included in the `webResearchTools()` bundle — add it explicitly. It reuses `fetch_url`'s security guards (http(s)-only, private/loopback/link-local refusal including redirects, and response-size caps).
