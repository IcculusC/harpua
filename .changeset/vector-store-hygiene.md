---
"@harpua/agent-tools": minor
---

Vector store hygiene. `VectorRecord` gains a `documentKey` (groups a document's chunks), and the `VectorStore` port gains a required `deleteByDocumentKey(documentKey)` method. `ingest` uses it to clear an explicit-id document's prior chunks before re-writing — so re-ingesting a shrunk document (or re-running `syncCorpus` over a trimmed file) no longer leaves orphaned tail chunks that retrieve stale content. Delete is an indexable equality on `documentKey`, not a prefix scan. Id-less/content-hash documents (everything `remember` writes) are unaffected. **Breaking (pre-1.0):** `VectorRecord` now requires `documentKey`, and custom `VectorStore` adapters must implement `deleteByDocumentKey`; `InMemoryVectorStore` already does.
