---
"@harpua/agent-tools": minor
---

Add the `remember` agent tool — the write half paired with `search_knowledge`'s read. A model saves an excerpt/note (`{ text, source?, title? }`) into a VectorStore via `ingest` (content-hash dedup, no disk round-trip). `search_knowledge` now renders web provenance (`title (source)`) for records without a `file:line`. Store-required; a plain factory like `searchKnowledgeTool` (no Nest DI).
