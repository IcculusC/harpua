# @harpua/agent-tools

## 0.1.4

### Patch Changes

- c22bcd5: `fetch_url` now converts HTML with `node-html-markdown` (proper GFM tables, more robust entities) in place of the hand-rolled extractor — saved markdown uses `*` list bullets and richer table output. `fetch_pdf` reports extracted size as chars/pages (was a misleading "N lines") and gets its own 16 MB size cap, independent of `fetch_url`'s 2 MB. Added a standalone `smoke:unpdf` node script that exercises the real (ESM) unpdf extraction path jest can't. README gains an explicit table of contents.

## 0.1.3

### Patch Changes

- 7bc62c0: Add the knowledge tool family: `search_knowledge` performs chunk/embed/index/cosine retrieval over a markdown sources directory (the corpus `fetch_url`/`fetch_pdf` build), with heading-aware chunks, true file:line provenance, a lazily-refreshed hidden sidecar index, and a deterministic keyless `MockEmbeddings` default (pass any LangChain embeddings instance for real semantics). NOTE: this adds the package's first runtime dependency, `ml-distance` (pure JS, cosine similarity).

## 0.1.2

### Patch Changes

- 7104a9f: Add `fetchPdfTool` (`fetch_pdf`): an opt-in tool that fetches a PDF by URL, extracts its text with [`unpdf`](https://github.com/unjs/unpdf), and saves it to `saveDir` as frontmattered markdown — the same fetch → save → explore loop as `fetch_url`, so a fetched PDF becomes searchable by `fileExplorationTools`.

  `unpdf` is an **optional peer dependency** (`pnpm add unpdf`); if it isn't installed the tool returns an install hint instead of throwing. `fetch_pdf` is exported on its own and is **not** included in the `webResearchTools()` bundle — add it explicitly. It reuses `fetch_url`'s security guards (http(s)-only, private/loopback/link-local refusal including redirects, and response-size caps).

- 171e1c9: Add the web-research tool family: `web_search` (SearXNG-backed search) and `fetch_url` (fetch a page, convert HTML to markdown with a dependency-free extractor, save with frontmatter), plus a `webResearchTools()` bundle. Pair with `fileExplorationTools` over the same directory to search saved pages.

  `fetch_url` refuses loopback/private/link-local addresses by default (including redirects that resolve to one) as an SSRF safety net; pass `allowPrivate: true` to reach a service on localhost or the LAN.

## 0.1.1

### Patch Changes

- ba31859: Add `fileExplorationTools` — a family of read-only, sandboxed, context-safe code
  tools (`search_files` via ripgrep, `read_lines`, `file_stats`). Every path is
  confined to a configured root (rejecting `..` traversal and symlink escapes) and
  every result is bounded with explicit truncation markers. Individual factories
  (`searchFilesTool`, `readLinesTool`, `fileStatsTool`) are exported alongside the
  bundle.
