---
"@harpua/agent-tools": minor
---

Chunking customization for `ingest()` — four new options plus a
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
