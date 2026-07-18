# @harpua/agent-tools

## 0.8.1

### Patch Changes

- 693f878: `prepareChunks(markdown, options?)` — export the pure chunk-prep half of
  `ingest()` (field report #18): chunk → sanitize → junk-filter → embed-text
  formatting, with no embedding or storage. A consumer running its own
  embed/upsert path into a separate collection no longer needs a hand-rolled
  duplicate of `embeddingInputFor` and the alnum junk floor just to keep chunk
  geometry in sync with `ingest()` — they call `prepareChunks` directly and
  get the same `{ text, embedText, chunkIndex, startLine, endLine,
headingTrail }` per chunk that `ingest()` embeds and stores.

  Options are the same four chunking knobs `ingest()` exposes
  (`maxChunkChars`, `minAlnumChars`, `embedHeadingTrail`, `sanitize`), same
  defaults, same strict zod validation (unknown keys throw). `ingest()` itself
  now composes over `prepareChunks` — the embed/upsert half is all that's left
  inline — so there is exactly one code path for chunk geometry and
  embedding-input formatting; direct `prepareChunks` callers and `ingest()`
  can never drift apart.

- e3728ce: `SkillRegistry` skip visibility (field report #17): a consumer's skill silently
  tripped the 16KB `SKILL.md` body cap and cost an hour of misdiagnosis because
  the only trace was a generic `onWarn` string — skips were a log, not data.
  `rescan()` now also returns `skippedSkills: { name, reason }[]` (one entry per
  skip, `reason` the same detail sent to `onWarn` minus the `skills: ` prefix),
  so a caller can actually act on a skip instead of grepping console output.
  Frontmatter failures — a bad `name` vs. an empty `description` — previously
  folded into one generic "no valid frontmatter" reason; the structured
  `reason` (never the `onWarn` text, which stays byte-identical for existing
  parsers) now folds in the first zod issue so the two are distinguishable.
  Separately, a directory with no `SKILL.md` at all (a misnamed `skill.md`?)
  now gets a single `onWarn` line instead of skipping silently — it still
  isn't counted in `skipped`/`skippedSkills`, since it was never a skill
  candidate. `renderSkillMenu` also grows an optional `opts.header` so a
  caller can swap the leading TOC line; omitting it reproduces the exact
  current bytes, keeping the prompt cache warm for everyone who doesn't need it.

## 0.8.0

### Minor Changes

- 38c5435: Chunking customization for `ingest()` — four new options plus a
  `metadata.chunkIndex` on every stored record, driven by field data from a
  scraped-PDF corpus (junk chunks 11% → 0, top-hit cosine 0.42 → 0.65+, and a
  native node crash on one unbatched ~88MB insert):

  - `sanitize?: (text: string) => string` — applied to each chunk's text before
    the junk floor, the embedder, and storage. Default strips C0/C1 control
    characters (keeping `\t`/`\n`) — scraped PDFs carry `0x01`–`0x05`/`0x0E`
    bytes that are embedding noise and broke the postgres wire protocol.
  - `minAlnumChars?: number` (default `0` = off) — junk floor on the
    ALPHANUMERIC character count: sparse-but-real table rows like
    `| 200-400mA | 5V |` (10 alnum chars) survive a floor of 8; `---` and
    heading-only stubs (0–6) are dropped.
  - `embedHeadingTrail?: boolean` (default `false`) — embed
    `"<trail joined with ' > '>: <chunk text>"` while storing the raw chunk
    text; the default keeps the legacy embedding input (trail + body joined by
    newlines).
  - `batchSize?: number` (default `64`) — caps records per
    `embeddings.embedDocuments` call and per `store.upsert` call; a 1.9MB doc
    at small chunk sizes is ~6k chunks and one giant call crashed node.

  Every record now carries `metadata.chunkIndex`, sequential per document and
  dense after the junk filter — the handle for the new window-expansion
  retrieval recipe documented in the README (consumer-side `chunk_index`
  column, one indexed BETWEEN query per window, stitch consecutive runs, merge
  overlaps, score = best hit; coerce `chunk_index` at the pg driver boundary
  and hard-cap stitched passages).

  `ingest` options are now validated strictly: unknown keys throw at call time
  instead of being silently ignored. Note: batched upserts mean a store failure mid-ingest can leave earlier batches committed (embed failures still precede any store mutation); and re-ingesting the same id-less text with different chunking options appends under new content-hash positions rather than replacing — give documents explicit ids when you expect to re-ingest with evolving options.

- 6874e16: New runtime skills family: the app's own agent discovers, loads, and follows skills at runtime. `SkillRegistry(dir)` scans `<skill>/SKILL.md` entries (zod-validated frontmatter, symlink/malformed/oversized entries skipped with a warning, `rescan()` for mid-session installs with a menu-bytes `changed` signal), `useSkillTool` returns a skill body as a persistent tool result and lists reference files with line counts without reading them, and `readSkillFileTool` serves capped line-numbered reads out of a per-skill jail (the skill's own directory is the sandbox root). `renderSkillMenu` renders the system-prompt TOC; the live-menu middleware stays a documented recipe so the package keeps its `@langchain/core` + zod dependency surface.

## 0.7.0

### Minor Changes

- 23109d6: Named knowledge backends: `searchKnowledgeTool` gains `name` and `description`
  overrides (defaults unchanged), so an app can mount the fetched-sources corpus
  and a remembered-excerpts store side by side as two distinctly named tools
  (e.g. `search_knowledge` + `search_memory`) and let the agent pick a backend
  explicitly. Failure/empty messages carry the resolved name. With a BYO `store`,
  `root` is no longer required (it was only ever read by the built-in corpus
  retrieval), and the store path's empty message no longer recommends
  `fetch_url` (corpus-specific guidance). `rememberTool` gains `searchToolName`
  (default `search_knowledge`) so its description and success message point at
  the tool that actually reads its store.

## 0.6.0

### Minor Changes

- ccf93ae: **`search_files` no longer reads hidden files, even when a glob names them.** Ripgrep skips dotfiles by default, but a positive `--glob` is a _whitelist_ that overrides that default **and** ignore rules — so `search_files(pattern, glob: ".env")` (and `*.env`, and any other glob naming it) read `.env` straight out, `.gitignore` notwithstanding. The protection was an accident of the default, and any agent that named the file defeated it. Hidden files are now excluded unconditionally: no glob overrides it.

  This is a **behavior change**: a caller who relied on an explicit glob to reach a dotfile will no longer get one.

  **Scope:** this closes `search_files` as a _search-based_ path to hidden-file contents. It does **not** make dotfiles unreadable across the toolkit — `read_lines` and `file_stats` still read and list them by design. If your threat model is "no agent may read `.env`", hardening `search_files` alone is not sufficient; that is a separate, deliberate decision about the file tools as a whole.

  **`search_files` also no longer reports `"No matches."` when it searched nothing at all.** Ripgrep exits `1` both when it searched files and found nothing _and_ when it searched no file whatsoever — and the second is not evidence of anything. The tool collapsed those into one string, telling agents a pattern was absent from files it had never opened. In production this cost ~11 model calls in a single turn: the agent disbelieved its own earlier `read_file` output and re-read the target file in six widening windows, hunting for lines the tool had just told it did not exist.

  An empty search now establishes **why** it was empty before answering, and names the mechanism — the remedies are opposites, and a wrong guess sends an agent hunting for a glob that cannot exist, or abandoning a file it could simply have read:

  - **Files were searched** → `"No matches."`, unchanged and true.
  - **The glob matched nothing** → says nothing was searched, and notes that a bare directory name (`src`) matches no files where `src/**` works.
  - **The files are hidden** → states that hidden files are never searched and that this is deliberate. Offers no bypass.
  - **Excluded by an ignore rule** → names ignore rules rather than blaming the glob, notes the rule may live in a parent directory or global git config rather than in the project, and points at `read_lines`.
  - **Both at once** (`.env` in `.gitignore`; `.venv/`, `.next/`, `.turbo/`) → names both.
  - **The glob spans both** (one match hidden, another ignored) → says so, rather than claiming _every_ match is hidden and silently never mentioning the ignored file.
  - **Inside `.git/`** → says so, rather than blaming a glob that was correct.
  - **A probe itself fails** → falls back to `"No matches."` and invents no cause.

  Diagnosis runs only on a search that already came back empty, and costs at most a few `rg --files --quiet` probes, which print nothing and exit at the first file found.

  `search_files`' description now states outright that hidden files are not searched.

- 8a8d4db: **`read_lines` and `file_stats` now refuse to open known-secret paths.** Previously `read_lines({ path: ".env" })` returned the file's contents — so hardening `search_files` against hidden-file reads (the sibling change) did not actually keep an injected agent away from secrets; it just closed one of several doors. This closes the path-reader door.

  The guard runs inside the sandbox's path resolution, on the **realpath'd** path — _after_ symlinks and `..` are collapsed — so a harmless-looking name (`notes.txt` → `.env`), a symlinked secret directory, a multi-hop symlink chain, or a normalizing traversal (`src/../.env`) all resolve to the real secret and are refused. The refusal names no alternative tool, so it can't double as a how-to.

  It is a **targeted** credential denylist, not a blanket dotfile ban: `.env` (and `.env.local`, `.env.production`, …), `.ssh/`, `.aws/`, `.gnupg/`, `.kube/`, `.docker/`, `.netrc`, `.pgpass`, `.git-credentials`, `.htpasswd`, `.npmrc`, `.pypirc`, `credentials`/`credentials.json`, `id_rsa`/`id_dsa`/`id_ecdsa`/`id_ed25519`, and `*.pem`/`*.key`/`*.p12`/`*.pfx`. Non-secret dotfiles (`.github/`, `.vscode/`, `.eslintrc`) stay readable, as do the placeholder `.env.example`/`.env.sample`/`.env.template` templates and public keys (`id_rsa.pub`).

  Configurable via the new `blockedSecretPatterns` option (an array of `RegExp` matched against the root-relative POSIX path): extend it with project-specific secrets, replace it, or pass `[]` to disable. Exports `DEFAULT_SECRET_PATTERNS` and `isSecretPath`.

  **Known limits.** The guard blocks reading secret _contents_, not the appearance of a non-hidden secret _filename_ in a `file_stats` directory listing (e.g. `server.pem` still shows as a name with its size; opening it is refused). And a hardlink to a secret under a non-secret name is not caught — `realpath` cannot distinguish a hardlink from the real file, so this is inherent to any path-based guard, and creating one requires filesystem write access these read-only tools never grant. Symlinks, `..` traversal, and a directory literally named `.env` _are_ all covered, because the check runs on the realpath'd, root-relative path.

## 0.5.0

### Minor Changes

- 5590de5: Vector store hygiene. `VectorRecord` gains a `documentKey` (groups a document's chunks), and the `VectorStore` port gains a required `deleteByDocumentKey(documentKey)` method. `ingest` uses it to clear an explicit-id document's prior chunks before re-writing — so re-ingesting a shrunk document (or re-running `syncCorpus` over a trimmed file) no longer leaves orphaned tail chunks that retrieve stale content. Delete is an indexable equality on `documentKey`, not a prefix scan. Id-less/content-hash documents (everything `remember` writes) are unaffected. **Breaking (pre-1.0):** `VectorRecord` now requires `documentKey`, and custom `VectorStore` adapters must implement `deleteByDocumentKey`; `InMemoryVectorStore` already does.

### Patch Changes

- ef98978: `fetch_pdf` now accepts valid PDFs served with a non-`application/pdf` content-type (e.g. `application/octet-stream`, the default for GitHub raw / S3 / many CDNs) by sniffing the `%PDF-` magic bytes of the already-fetched body. It still refuses genuine non-PDF bodies — it just stops trusting a mislabeled header over the actual content.

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
