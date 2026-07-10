# @harpua/agent-tools

## 0.4.0

### Minor Changes

- 52a7bfd: Add the `remember` agent tool — the write half paired with `search_knowledge`'s read. A model saves an excerpt/note (`{ text, source?, title? }`) into a VectorStore via `ingest` (content-hash dedup, no disk round-trip). `search_knowledge` now renders web provenance (`title (source)`) for records without a `file:line`. Store-required; a plain factory like `searchKnowledgeTool` (no Nest DI).

## 0.3.0

### Minor Changes

- 5907a64: Add source-agnostic `ingest(documents, { embeddings, store })`: chunk, embed, and upsert plain `{ id?, text, metadata? }` documents from any source into a VectorStore. Documents without an id get a content-hash id (free dedup). `syncCorpus` is now a thin markdown-directory source on top of `ingest`.

## 0.2.0

### Minor Changes

- b469204: Make `search_knowledge`'s storage pluggable via a lowest-common-denominator `VectorStore` port (`upsert` + `query`, with scoring/top-K pushed into the store). The built-in on-disk corpus retrieval is the default and its behavior is unchanged; pass `store` to `searchKnowledgeTool` to bring your own backend (e.g. pgvector via TypeORM). `syncCorpus` ingests a markdown folder into any store; `InMemoryVectorStore` is a records-only reference/testing adapter. Tuning is per-adapter: a typed generic `VectorStore<Q>` with adapter-config defaults plus per-call override. No new dependencies.

## 0.1.5

### Patch Changes

- 4c9a135: fetch_pdf extracts per page and chunkMarkdown gains a hard size ceiling — field fix for giant-PDF corpora.

  - **fetch_pdf** no longer passes `mergePages: true` to unpdf: each non-blank page becomes a `## Page N` section in the saved markdown. Heading-aware consumers (search_knowledge's chunker) now get page-sized chunks with "Page N" heading trails instead of one blank-line-free wall (a real ESP32 datasheet produced a single 148KB chunk that every embedding endpoint rejected — with an inscrutable error, because OpenRouter returns embedding failures as HTTP 200 bodies). Search hits over PDFs now name the page they came from. A PDF with no extractable text (scanned/image-only) returns a friendly message instead of saving an empty file.
  - **⚠️ `UnpdfModuleLike` seam shape changed**: `extractText(data)` (no options) returning `{ totalPages, text: string[] }` — anyone implementing the injectable `loadUnpdf` seam (typically test mocks) must return per-page arrays now.
  - **chunkMarkdown** hard-splits paragraphs that alone exceed `maxChunkChars` (at line boundaries; cap-sized raw slices for single monster lines, spans kept true) instead of emitting them whole. Defense-in-depth for hand-dropped blank-line-free markdown; the previous "a single over-cap paragraph stays whole" behavior is gone deliberately.

- 46d4bbd: fetch_url / fetch_pdf confirmations name the saved file as the file-exploration tools address it (bare filename, "as x.md") instead of a cwd-relative path ("to sources/x.md"). Models echo the confirmation verbatim into read_lines/search_files, which are jailed to the same directory — the old wording double-resolved ("sources/sources/x.md") and every follow-up read failed. Observed live in the notebook consumer app.

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
