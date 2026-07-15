---
"@harpua/agent-tools": patch
---

`prepareChunks(markdown, options?)` — export the pure chunk-prep half of
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
