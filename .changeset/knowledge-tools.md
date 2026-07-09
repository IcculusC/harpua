---
"@harpua/agent-tools": patch
---

Add the knowledge tool family: `search_knowledge` performs chunk/embed/index/cosine retrieval over a markdown sources directory (the corpus `fetch_url`/`fetch_pdf` build), with heading-aware chunks, true file:line provenance, a lazily-refreshed hidden sidecar index, and a deterministic keyless `MockEmbeddings` default (pass any LangChain embeddings instance for real semantics). NOTE: this adds the package's first runtime dependency, `ml-distance` (pure JS, cosine similarity).
