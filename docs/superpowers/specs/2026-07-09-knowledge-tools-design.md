# Knowledge Tool Family (Retrieval Core) for `@harpua/agent-tools` — Design

**Date:** 2026-07-09
**Status:** Approved (brainstorming session)
**Target package:** `packages/agent-tools`

## Purpose

Semantic-ish retrieval over a directory of markdown documents — the corpus
the web-research family builds (`fetch_url` saves pages, and `fetch_pdf`
saves extracted PDF text, both as frontmattered markdown via the shared
`savePage`). An agent asks a
natural-language question through a `search_knowledge` tool and gets the
top-k most relevant chunks with file and line provenance, so it can quote
them or page deeper with `read_lines`. This is the retrieval core of a
deliberately simple RAG: chunking, embedding, a sidecar index, and cosine
retrieval. No vector database.

## Decisions made

- **Slice:** retrieval core, over the existing markdown corpus. PDF
  extraction ALREADY LANDED on main (#14, `fetch_pdf` behind an optional
  `unpdf` peer) and writes into the same corpus — datasheets become
  searchable through this family with zero extra work here. An embeddings
  module in `@harpua/models` remains a separate, later spec.
- **Placement:** `@harpua/agent-tools`, new `src/knowledge/` family, same
  factory/bundle conventions as `file-exploration/` and `web-research/`.
- **Dependencies are allowed when appropriate** (user decision, relaxing the
  package's zero-dependency status): `ml-distance` for cosine similarity —
  the package's FIRST runtime dependency; pure JS, no native code. Nothing
  else.
- **Embedder contract:** `@langchain/core`'s `Embeddings` interface
  (existing peer). Consumers plug in any LangChain embeddings instance. The
  user's intended real arm is **OpenRouter's embeddings endpoint**
  (OpenAI-compatible `/api/v1/embeddings`; e.g. `nomic-ai/nomic-embed-text-v1`)
  via `OpenAIEmbeddings` with a base-URL override — consumer-provided, NOT a
  dependency of this package.
- **Keyless default:** a built-in deterministic `MockEmbeddings` (the
  MockChatModel of embeddings) — hashed bag-of-words into a fixed-dimension
  normalized vector. Honest framing: lexical similarity, not semantic; it
  exists so the pipeline boots keyless and tests run offline. Real semantics
  arrive by passing a real embeddings instance; nothing else changes.
- **Storage:** one sidecar index file per corpus dir at
  `<root>/.knowledge/index.json`. Hidden directory on purpose: ripgrep skips
  hidden files by default, so `search_files` over the same corpus never
  greps vector soup. Brute-force cosine over all chunks — a project corpus
  is dozens-to-hundreds of pages; this is milliseconds.
- **Freshness:** lazy, on every search call — no coupling to `fetch_url`.
  Anything that drops `.md` files in the dir becomes searchable; that seam
  is exactly where PDF extraction plugs in later.
- **Vector DBs (sqlite-vec/vectra/LanceDB) explicitly out of scope.** The
  index file carries a `version` field and the tool's reply format is the
  public contract, so a future store swap (if the corpus ever outgrows
  brute force) is contained and does not belong in this package.

## Components

All new code in `packages/agent-tools/src/knowledge/`, one artifact per file.

### `options.ts`

Strict zod schemas (`.strict()`, function-valued options via
`z.custom<T>((v) => typeof v === "function")`), mirroring the sibling
families:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `root` | `string` \| `(config?) => string` | required | Corpus directory (per-call resolver enables per-thread corpora, same pattern as `fetch_url.saveDir`). |
| `embeddings` | `Embeddings` (from `@langchain/core/embeddings`) | `new MockEmbeddings()` | The embedder. Any LangChain embeddings instance. |
| `topK` | positive int ≤ 20 | 5 | Chunks returned per query. |
| `maxChunkChars` | positive int | 1200 | Oversized sections split at paragraph boundaries to stay under this. |
| `minScore` | number | unset (no filter) | When set, chunks scoring below it are omitted. Optional with NO default — cosine scores from real embedders can be negative, so 0 is not a safe "off" value. |

### `chunk-markdown.ts` — pure function, no I/O

`chunkMarkdown(markdown: string, options: { maxChunkChars: number }): Chunk[]`
where `Chunk = { text, startLine, endLine, headingTrail: string[] }`.

- Splits at `##`/`###` heading boundaries (what the web-research extractor
  emits). Content before the first heading is its own chunk. YAML
  frontmatter (`--- … ---` at the top) is excluded from chunk text but
  line numbers remain true to the file.
- Sections longer than `maxChunkChars` split further at blank-line
  (paragraph) boundaries; a single paragraph over the cap becomes its own
  chunk (never split mid-paragraph). No overlap in v1.
- `headingTrail` is the path of headings above the chunk (e.g.
  `["LM317", "Electrical Characteristics"]`), prepended to the text at
  embedding time for context, and shown in results.

### `mock-embeddings.ts`

`class MockEmbeddings implements Embeddings` (`embedDocuments`,
`embedQuery`). Feature-hashed bag-of-words: lowercase word tokens hashed
(FNV-1a, same hand-rolled hash as `save-page.ts`) into a 256-dim vector,
L2-normalized. Deterministic; word overlap → higher cosine. JSDoc states
plainly it is a keyless/test stand-in, not a semantic embedder.

### `knowledge-index.ts` — sidecar persistence + freshness

- Index schema: `{ version: 1, fingerprint: string, files: { [relPath]:
  { hash, chunks: [{ text, startLine, endLine, headingTrail, vector }] } } }`.
- `fingerprint` identifies the embedder: vector dimension plus the
  instance's constructor name. Mismatch → full reindex (switching from mock
  to real embeddings must never mix vector spaces).
- File content hashes via `node:crypto` sha256 (no new dep).
- `syncIndex(root, embeddings, opts)`: list `*.md` files (top level of the
  corpus dir; the `.knowledge/` dir is never scanned), compare hashes,
  re-chunk + re-embed only new/changed files, drop entries for deleted
  files, write the index back. Returns the loaded index.
- A corrupt or unreadable index file is treated as absent and rebuilt from
  the markdown — the sidecar is a cache; markdown stays the source of truth.

### `search-knowledge.ts` — `searchKnowledgeTool(options)`

Tool name `search_knowledge`; input `{ query: string }` with a
`.describe()` teaching the model to ask natural-language questions and to
follow up with `read_lines` for full context.

Per call: resolve `root` → `syncIndex` (lazy freshness) → embed the query →
cosine (via `ml-distance`) against every chunk → top-k above `minScore` →
reply formatted as, per hit:

```
1. lm317-product-page-a1b2c3d4.md:41-58 (score 0.83) — LM317 > Electrical Characteristics
   <chunk text>
```

Failure posture (house rule — never throws): missing/empty corpus →
"nothing indexed yet — save some pages first (fetch_url) or add markdown
files"; embedder call failure → friendly string naming the cause (e.g. the
OpenRouter arm's HTTP error); index write failure → still answers the query
from the in-memory index, notes the cache didn't persist.

### `index.ts` additions

Export `searchKnowledgeTool`, `MockEmbeddings`, `chunkMarkdown`, and the
option types, in a new family comment block. No bundle — a one-tool family
doesn't need one; if a reindex/status tool ever proves necessary it can
join later (YAGNI now).

## Interplay with existing families

- `fetch_url` saves a page → the next `search_knowledge` call indexes it.
- Results carry `file:line` spans that feed `read_lines` directly, and the
  corpus stays fully `search_files`-able — lexical and semantic search
  coexist over the same directory.
- The consumer pairing (app-side, later): `webResearchTools({ saveDir })` +
  `fileExplorationTools({ root })` + `searchKnowledgeTool({ root, embeddings })`
  over one sources directory.

## Testing

Fully offline and deterministic, in `src/__tests__/` per house style:

- **Chunker:** heading splits, pre-heading content, frontmatter exclusion
  with true line numbers, long-section paragraph splitting, single-huge-
  paragraph case, headingTrail correctness.
- **MockEmbeddings:** determinism (same text → same vector), dimension,
  normalization, overlap ordering (shared-word texts score higher than
  disjoint ones).
- **Index lifecycle:** first build; file modified → only its chunks change;
  file deleted → entries dropped; fingerprint change → full rebuild;
  corrupt index file → rebuilt without error.
- **Tool:** temp-dir corpus with 2–3 markdown fixtures — relevant chunk
  ranks first for an overlapping query; `topK`/`minScore` honored; empty
  corpus message; `root`-as-resolver receives the run config; embedder
  failure returns a friendly string (fake embeddings instance that throws).
- **Cross-family loop:** `fetch_url` (real, merged in #13) with an injected
  `fetchFn` saves a fixture page into a temp dir → `search_knowledge` over
  that dir returns the page's content with correct file:line provenance.

## Out of scope

- Embeddings module/arms in `@harpua/models` (follow-up; this package only
  consumes the `Embeddings` interface).
- Vector databases, ANN indexing, hybrid BM25 fusion, rerankers.
- Cross-corpus / multi-root search.

## Process

Harpua's own conventions and skills govern the implementation: repo
CLAUDE.md, `release` skill (changeset required — **patch**; flag the new
`ml-distance` runtime dependency prominently in the changeset text),
`verify` skill (ROOT protocol `pnpm turbo build lint test --force`),
`turbo` skill for task running, and the guard guidance added to
`graph-operations/references/tool.md` by #15 for tools touching
model-supplied resources — `search_knowledge` complies by construction
(the model supplies only a query string; the corpus root is resolved from
the run config, never from model input; the tool reads only `*.md` files
under that root), and the implementation must not weaken that posture. Work happens in the external worktree
`/Users/leathcooper/ai-workspace/harpua-worktrees/feat-knowledge-tools` on
branch `feat/knowledge-tools` (based on post-#13 main), lands via PR merged
by the maintainer. README gets a "Knowledge" family section following the
existing structure.
