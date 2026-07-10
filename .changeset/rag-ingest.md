---
"@harpua/agent-tools": minor
---

Add source-agnostic `ingest(documents, { embeddings, store })`: chunk, embed, and upsert plain `{ id?, text, metadata? }` documents from any source into a VectorStore. Documents without an id get a content-hash id (free dedup). `syncCorpus` is now a thin markdown-directory source on top of `ingest`.
