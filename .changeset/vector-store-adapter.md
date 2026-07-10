---
"@harpua/agent-tools": minor
---

Make `search_knowledge`'s storage pluggable via a lowest-common-denominator `VectorStore` port (`upsert` + `query`, with scoring/top-K pushed into the store). The built-in on-disk corpus retrieval is the default and its behavior is unchanged; pass `store` to `searchKnowledgeTool` to bring your own backend (e.g. pgvector via TypeORM). `syncCorpus` ingests a markdown folder into any store; `InMemoryVectorStore` is a records-only reference/testing adapter. Tuning is per-adapter: a typed generic `VectorStore<Q>` with adapter-config defaults plus per-call override. No new dependencies.
