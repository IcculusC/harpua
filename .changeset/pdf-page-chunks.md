---
"@harpua/agent-tools": patch
---

fetch_pdf extracts per page and chunkMarkdown gains a hard size ceiling — field fix for giant-PDF corpora.

- **fetch_pdf** no longer passes `mergePages: true` to unpdf: each non-blank page becomes a `## Page N` section in the saved markdown. Heading-aware consumers (search_knowledge's chunker) now get page-sized chunks with "Page N" heading trails instead of one blank-line-free wall (a real ESP32 datasheet produced a single 148KB chunk that every embedding endpoint rejected — with an inscrutable error, because OpenRouter returns embedding failures as HTTP 200 bodies). Search hits over PDFs now name the page they came from. A PDF with no extractable text (scanned/image-only) returns a friendly message instead of saving an empty file.
- **⚠️ `UnpdfModuleLike` seam shape changed**: `extractText(data)` (no options) returning `{ totalPages, text: string[] }` — anyone implementing the injectable `loadUnpdf` seam (typically test mocks) must return per-page arrays now.
- **chunkMarkdown** hard-splits paragraphs that alone exceed `maxChunkChars` (at line boundaries; cap-sized raw slices for single monster lines, spans kept true) instead of emitting them whole. Defense-in-depth for hand-dropped blank-line-free markdown; the previous "a single over-cap paragraph stays whole" behavior is gone deliberately.
